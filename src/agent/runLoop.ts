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
import { getMode } from './modes';
import { getModeInstructions } from '../shared/config';
import { createLogger } from '../shared/logger';
import { analyzeConversationPattern } from './supervisor';

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
  projectRoot: string;
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
    projectRoot,
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

  progressStore.clearProgress(sessionId);
  progressStore.setRunning(sessionId, true);
  try {
    const projectId = sessionStore.resolveProjectId(projectRoot);
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
      systemPrompt = systemPrompt + '\n\n## Pull request context (for reference)\n\n' + prContextText;
    }
    const tools = getToolsForMode(modeId);
    log.debug(
      'runLoop',
      sessionId,
      'mode:',
      modeId,
      'tools:',
      tools.map((t) => t.function.name).join(', ')
    );

    const messages: llm.ChatMessage[] = [
      ...session.messages.map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant' | 'tool',
        content: m.content,
        toolCalls: m.toolCalls,
        toolCallId: m.toolCallId,
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

    const maxIterations = Infinity;
    let iteration = 0;

    while (iteration < maxIterations) {
      if (signal?.aborted) break;
      iteration++;
      const response = await llm.chat(messages, {
        tools,
        providerId,
        model,
        projectRoot,
        signal,
        sessionId,
      });
      
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

      log.debug(
        'llm.chat returned',
        'sessionId:',
        sessionId,
        'content length:',
        response.content?.length ?? 0,
        'toolCalls:',
        response.toolCalls?.length ?? 0
      );

      if (response.toolCalls?.length) {
        messages.push({
          role: 'assistant',
          content: response.content || ' ',
          toolCalls: response.toolCalls,
        });
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
          const result = await executeTool(toolName, args, {
            sessionId,
            projectRoot,
          });
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
        }
        sessionStore.updateSessionMessages(
          sessionId,
          messages.filter(
            (m) => m.role !== 'system'
          ) as sessionStore.ChatMessage[]
        );
        if (signal?.aborted) break;
        continue;
      }

      messages.push({
        role: 'assistant',
        content: response.content,
      });
      sessionStore.updateSessionMessages(
        sessionId,
        messages.filter(
          (m) => m.role !== 'system'
        ) as sessionStore.ChatMessage[]
      );
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
