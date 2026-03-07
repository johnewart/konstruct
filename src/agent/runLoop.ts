/*
 * Copyright 2026 John Ewart <john@johnewart.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as sessionStore from '../shared/sessionStore';
import { getToolStatus } from './toolStatus';
import * as llm from '../shared/llm';
import { executeTool } from './tools/executor';
import './tools/runners';
import { getToolsForMode } from './toolDefinitions';
import { isBackendTool } from '../shared/toolClassification';
import { runBackendTool } from '../backend/mcp/backendTools';
import type { Workspace } from '../shared/workspace';
import { getMode } from './modes';
import { loadConfig, getProviderById, getModeInstructions, getDisabledToolsForProject } from '../shared/config';
import { getProviderAdapter } from '../shared/providers';
import { createLogger } from '../shared/logger';
import { analyzeConversationPattern } from './supervisor';
import { SdkAbortWithHistoryError, type ToolCallHistoryEntry } from './claude-sdk-agent';

const log = createLogger('agent');

const RULES_DIR = '.konstruct/rules';

export function getCombinedRules(projectRoot: string): string {
  const dir = path.join(projectRoot, RULES_DIR);
  if (!fs.existsSync(dir)) return '';
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
  if (files.length === 0) return '';
  const parts: string[] = [];
  const baseDir = path.resolve(projectRoot, RULES_DIR);
  for (const name of files) {
    const fullPath = path.join(baseDir, name);
    const resolved = path.resolve(fullPath);
    if (!resolved.startsWith(baseDir) || !fs.existsSync(resolved)) continue;
    try {
      const content = fs.readFileSync(resolved, 'utf-8').trim();
      if (content) parts.push(`## ${name}\n\n${content}`);
    } catch {
      // skip unreadable
    }
  }
  if (parts.length === 0) return '';
  return (
    '---\nProject rules (from .konstruct/rules/):\n\n' + parts.join('\n\n')
  );
}

const MAX_TOOL_RESULT_CHARS = 28 * 1024;

/**
 * Compute which messages to send to the provider. For stateful (sliced) providers:
 * - First turn (no provider session id or messageCursor 0): send system + all messages since cursor.
 * - Resuming (provider session id set and messageCursor > 0): send only new messages (no system, no prior history).
 * Exported for tests.
 */
export function getChatMessagesForProvider(params: {
  messages: llm.ChatMessage[];
  providerId: string;
  isSlicedProvider: boolean;
  providerMessageCursors?: Record<string, number>;
  providerSessionIds?: Record<string, string>;
}): llm.ChatMessage[] {
  const { messages, providerId, isSlicedProvider, providerMessageCursors, providerSessionIds } = params;
  const messageCursor = isSlicedProvider ? (providerMessageCursors?.[providerId ?? ''] ?? 0) : 0;
  const isResuming =
    isSlicedProvider &&
    (providerSessionIds?.[providerId ?? ''] != null) &&
    messageCursor > 0;
  if (isResuming) return messages.slice(messageCursor + 1);
  if (isSlicedProvider) return [messages[0], ...messages.slice(messageCursor + 1)];
  return messages;
}

/** Persist MCP tool call history to the session transcript (used incrementally and on SDK abort). */
function persistMcpToolHistory(
  sessionId: string,
  baseMessages: sessionStore.ChatMessage[],
  toolCallHistory: ToolCallHistoryEntry[],
  finalAssistantContent?: string
): void {
  if (toolCallHistory.length === 0) return;
  const assistantMsg: sessionStore.ChatMessage = {
    role: 'assistant',
    content: finalAssistantContent ?? ' ',
    toolCalls: toolCallHistory.map((th) => ({
      id: th.id,
      type: 'function',
      function: { name: th.name, arguments: th.arguments },
    })),
  };
  const toolMsgs: sessionStore.ChatMessage[] = toolCallHistory.map((th) => {
    let content = th.result;
    if (content.length > MAX_TOOL_RESULT_CHARS) {
      content =
        content.slice(0, MAX_TOOL_RESULT_CHARS) +
        '\n\n(truncated; output exceeded ' +
        MAX_TOOL_RESULT_CHARS +
        ' chars)';
    }
    return { role: 'tool' as const, content, toolCallId: th.id };
  });
  sessionStore.updateSessionMessages(sessionId, [
    ...baseMessages,
    assistantMsg,
    ...toolMsgs,
  ]);
}

export interface RunProgressStore {
  clearProgress(sessionId: string): void;
  setRunning(sessionId: string, running: boolean): void;
  pushProgress(
    sessionId: string,
    entry: {
      type: 'status' | 'tool';
      description?: string;
      toolName?: string;
      resultSummary?: string;
      pending?: boolean;
    }
  ): void;
  updateLastResult(sessionId: string, resultSummary: string): void;
}

export interface RunAgentLoopInput {
  workspace: Workspace;
  sessionId: string;
  content: string;
  modeId?: string;
  providerId?: string;
  model?: string;
  progressStore: RunProgressStore;
  signal?: AbortSignal;
  /** When set (e.g. PR page chat), appended to system prompt so the agent has PR context. */
  prContextText?: string;
}

/**
 * Runs the LLM + tool loop for one sendMessage. Updates session and progress via the given stores.
 * Used by both the web server (single-process) and the agent worker.
 */
export async function runAgentLoop(
  input: RunAgentLoopInput
): Promise<sessionStore.Session> {
  const {
    workspace,
    sessionId,
    content,
    modeId: modeIdOpt,
    providerId,
    model,
    progressStore,
    signal,
    prContextText,
  } = input;
  const modeId = modeIdOpt ?? 'implementation';
  const projectRoot = workspace.getLocalPath() ?? '';
  const projectId = workspace.id;

  progressStore.clearProgress(sessionId);
  progressStore.setRunning(sessionId, true);
  try {
    const session = sessionStore.getSession(sessionId, projectId);
    if (!session) {
      throw new Error(
        `Session not found. It may belong to a different project (current project: ${projectId}). Try switching project or opening a session from the current project.`
      );
    }

    const mode = getMode(modeId);
    let systemPrompt =
      mode?.systemPrompt ?? getMode('implementation')!.systemPrompt;
    const combinedRules = getCombinedRules(projectRoot);
    if (combinedRules) systemPrompt = systemPrompt + '\n\n' + combinedRules;
    const extendedInstructions = getModeInstructions(modeId);
    if (extendedInstructions) systemPrompt = systemPrompt + '\n\n' + extendedInstructions;
    if (prContextText) {
      systemPrompt =
        systemPrompt +
        '\n\n## Pull request context (for reference)\n\nThe following is the **proposed** PR (diff). Added (A) files are not in the repo yet; their content is only in this section.\n\n' +
        prContextText;
    }
    const { providerType, providerConfig } =
      providerId && projectRoot
        ? (() => {
            const config = loadConfig(projectRoot);
            const p = getProviderById(config, providerId);
            return { providerType: (p?.type ?? providerId).toLowerCase(), providerConfig: p };
          })()
        : { providerType: (providerId ?? '').toLowerCase(), providerConfig: undefined };
    const additionalPrompt = providerType ? getProviderAdapter(providerType).additionalSystemPrompt?.() ?? '' : '';
    if (additionalPrompt) systemPrompt = systemPrompt + '\n\n' + additionalPrompt;
    const allTools = getToolsForMode(modeId);
    const disabledToolNames = new Set(getDisabledToolsForProject(projectId));
    const tools = disabledToolNames.size
      ? allTools.filter((t) => !disabledToolNames.has(t.function.name))
      : allTools;
    log.debug(
      'runLoop',
      sessionId,
      'mode:',
      modeId,
      'tools:',
      tools.map((t) => t.function.name).join(', '),
      disabledToolNames.size ? `(${disabledToolNames.size} disabled)` : ''
    );

    const messages: llm.ChatMessage[] = [
      ...session.messages.map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant' | 'tool',
        content: m.content,
        toolCalls: m.toolCalls,
        toolCallId: m.toolCallId,
        providerId: m.providerId,
      })),
      { role: 'user', content },
    ];

    if (messages[0]?.role !== 'system') {
      messages.unshift({ role: 'system', content: systemPrompt });
    }

    sessionStore.updateSessionMessages(
      sessionId,
      messages.filter((m) => m.role !== 'system') as sessionStore.ChatMessage[]
    );

    // Providers whose context is managed externally (they run their own tool loop).
    // For these we only send new messages since the last run, not the full history.
    // Respects explicit `stateful` flag in provider config; falls back to type-based convention.
    const isStatefulByType =
      providerType === 'claude_sdk' || providerType === 'cursor' || providerType === 'claude_v2';
    const isSlicedProvider = providerConfig?.stateful ?? isStatefulByType;
    // Index into messages[] (excluding system at [0]) up to which we've already sent.
    // messages = [system(0), ...session.messages(1..N), newUserMsg(N+1)]
    // cursor is the count of session.messages already sent, so slice point = cursor + 1.
    const messageCursor = isSlicedProvider
      ? (session.providerMessageCursors?.[providerId ?? ''] ?? 0)
      : 0;

    // Ensure stateful providers have a session id for resume (cursor = Konstruct sessionId; claude_v2 overwrites with SDK id when returned).
    if (isSlicedProvider && providerId && !session.providerSessionIds?.[providerId]) {
      sessionStore.updateProviderSessionId(sessionId, providerId, sessionId);
      session.providerSessionIds = session.providerSessionIds ?? {};
      session.providerSessionIds[providerId] = sessionId;
    }

    const maxIterations = Infinity;
    let iteration = 0;

    while (iteration < maxIterations) {
      if (signal?.aborted) break;
      iteration++;
      let response: Awaited<ReturnType<typeof llm.chat>>;
      const chatMessages = getChatMessagesForProvider({
        messages,
        providerId: providerId ?? '',
        isSlicedProvider,
        providerMessageCursors: session.providerMessageCursors,
        providerSessionIds: session.providerSessionIds,
      });
      try {
        response = await llm.chat(chatMessages, {
          tools,
          providerId,
          model,
          projectRoot,
          signal,
          sessionId,
          progressStore,
          sdkSessionId: session.providerSessionIds?.[providerId ?? ''],
          onMcpToolComplete: (toolCallHistory) => {
            persistMcpToolHistory(
              sessionId,
              messages.filter((m) => m.role !== 'system') as sessionStore.ChatMessage[],
              toolCallHistory
            );
          },
        });
      } catch (err) {
        if (SdkAbortWithHistoryError.is(err) && err.toolCallHistory.length > 0) {
          persistMcpToolHistory(
            sessionId,
            messages.filter((m) => m.role !== 'system') as sessionStore.ChatMessage[],
            err.toolCallHistory
          );
        }
        throw err;
      }

      // Fire-and-forget supervisor check every 10-15 turns
      // DISABLED - causing cache invalidation issues when injecting comments
      if (false && messages.length % 15 === 0) {
        setTimeout(() => {
          const recent = messages.slice(-50);
          const analysis = analyzeConversationPattern(recent);

          if (analysis.intervention) {
            // High-priority stop command
            sessionStore.addMessage(sessionId, {
              role: 'user',
              content: '[Agent supervisor]: Stop. This path is unlikely to succeed. Please reset or ask for user guidance.'
            });
          } else if (analysis.suggestion) {
            // Gentle optimization nudge
            sessionStore.addMessage(sessionId, {
              role: 'user',
              content: `[Agent supervisor]: ${analysis.suggestion}`
            });
          }
        }, 0); // Async, non-blocking
      }

      if (response.sdkSessionId && providerId) {
        sessionStore.updateSdkSessionId(sessionId, providerId, response.sdkSessionId);
      }
      log.debug(
        'llm.chat returned',
        'sessionId:',
        sessionId,
        'content length:',
        response.content?.length ?? 0,
        'toolCalls:',
        response.toolCalls?.length ?? 0
      );

      if (response.toolCallHistory?.length) {
        messages.push({
          role: 'assistant',
          content: ' ',
          providerId: providerId ?? undefined,
          toolCalls: response.toolCallHistory.map((th) => ({
            id: th.id,
            type: 'function',
            function: { name: th.name, arguments: th.arguments },
          })),
        });
        const maxToolResultChars = 28 * 1024;
        for (const th of response.toolCallHistory) {
          let resultContent = th.result;
          if (resultContent.length > maxToolResultChars) {
            resultContent =
              resultContent.slice(0, maxToolResultChars) +
              '\n\n(truncated; output exceeded ' +
              maxToolResultChars +
              ' chars)';
          }
          messages.push({
            role: 'tool',
            content: resultContent,
            toolCallId: th.id,
          });
        }
        messages.push({
          role: 'assistant',
          content: response.content,
          providerId: providerId ?? undefined,
        });
        sessionStore.updateSessionMessages(
          sessionId,
          messages.filter(
            (m) => m.role !== 'system'
          ) as sessionStore.ChatMessage[]
        );
        if (isSlicedProvider && providerId) {
          sessionStore.updateProviderMessageCursor(
            sessionId,
            providerId,
            messages.filter((m) => m.role !== 'system').length
          );
        }
        break;
      }

      if (response.toolCalls?.length) {
        messages.push({
          role: 'assistant',
          content: response.content || ' ',
          providerId: providerId ?? undefined,
          toolCalls: response.toolCalls,
        });
        // Persist assistant's tool decisions immediately so transcript/context is up to date
        sessionStore.updateSessionMessages(
          sessionId,
          messages.filter(
            (m) => m.role !== 'system'
          ) as sessionStore.ChatMessage[]
        );
        for (const tc of response.toolCalls) {
          if (signal?.aborted) break;
          const toolName = tc.function.name;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          } catch {
            args = {};
          }
          log.debug('tool', 'sessionId:', sessionId, toolName, args);
          if (
            toolName === 'set_status' &&
            typeof args.description === 'string'
          ) {
            progressStore.pushProgress(sessionId, {
              type: 'status',
              description: args.description,
            });
          } else {
            const statusDesc = getToolStatus(toolName, args);
            progressStore.pushProgress(sessionId, {
              type: 'tool',
              toolName,
              description: statusDesc,
              pending: true,
            });
          }
          let result;
          if (isBackendTool(toolName)) {
            result = await runBackendTool(toolName, args, {
              projectRoot,
              sessionId,
              progressStore,
            });
          } else {
            const conn = await workspace.getOrSpawnAgent();
            result = await conn.executeTool(toolName, args);
          }
          let resultContent = result.error ?? result.result ?? '';
          const maxToolResultChars = 28 * 1024;
          if (resultContent.length > maxToolResultChars) {
            resultContent =
              resultContent.slice(0, maxToolResultChars) +
              '\n\n(truncated by server; output exceeded ' +
              maxToolResultChars +
              ' chars to protect context length)';
          }
          const resultSummary =
            resultContent.length > 80
              ? resultContent.slice(0, 77) + '…'
              : resultContent;
          if (toolName !== 'set_status')
            progressStore.updateLastResult(sessionId, resultSummary);
          messages.push({
            role: 'tool',
            content: resultContent,
            toolCallId: tc.id,
          });
          // Persist each tool result immediately so transcript has full context if run is interrupted
          sessionStore.updateSessionMessages(
            sessionId,
            messages.filter(
              (m) => m.role !== 'system'
            ) as sessionStore.ChatMessage[]
          );
        }
        if (signal?.aborted) break;
        continue;
      }

      messages.push({
        role: 'assistant',
        content: response.content,
        providerId: providerId ?? undefined,
      });
      sessionStore.updateSessionMessages(
        sessionId,
        messages.filter(
          (m) => m.role !== 'system'
        ) as sessionStore.ChatMessage[]
      );
      if (isSlicedProvider && providerId) {
        sessionStore.updateProviderMessageCursor(
          sessionId,
          providerId,
          messages.filter((m) => m.role !== 'system').length
        );
      }
      break;
    }

    const toSave = messages.filter((m) => m.role !== 'system');
    sessionStore.updateSessionMessages(
      sessionId,
      toSave as sessionStore.ChatMessage[]
    );
    log.info('runLoop done', sessionId, 'iterations:', iteration);
    return sessionStore.getSession(sessionId)!;
  } finally {
    progressStore.clearProgress(sessionId);
    progressStore.setRunning(sessionId, false);
  }
}
