/**
 * AWS Bedrock Converse API adapter (aligned with Go internal/llm/bedrock.go).
 * Uses @aws-sdk/client-bedrock-runtime with default credential chain.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Message,
  type SystemContentBlock,
  type ToolConfiguration,
  type ToolSpecification,
} from '@aws-sdk/client-bedrock-runtime';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import type { ChatMessage, ToolDefinition } from './llm';
import { getBedrockEnv } from './providers';
import { createLogger } from '../logger';

const log = createLogger('bedrock');

function messagesToBedrock(messages: ChatMessage[]): {
  system: SystemContentBlock[];
  bedMessages: Message[];
} {
  let systemText = '';
  const bedMessages: Message[] = [];
  const pendingToolResults: ContentBlock[] = [];
  const lastAssistantToolUseIds = new Set<string>();

  const flushToolResults = (): ContentBlock[] => {
    if (pendingToolResults.length === 0) return [];
    const valid = pendingToolResults.filter((b) => {
      if ('toolResult' in b && b.toolResult) {
        const id = b.toolResult.toolUseId;
        if (lastAssistantToolUseIds.has(id)) return true;
        return false;
      }
      return true;
    });
    pendingToolResults.length = 0;
    return valid;
  };

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemText = msg.content;
      continue;
    }
    if (msg.role === 'tool') {
      pendingToolResults.push({
        toolResult: {
          toolUseId: msg.toolCallId ?? '',
          content: [{ text: msg.content }],
          status: 'success',
        },
      });
      continue;
    }
    if (msg.role === 'user') {
      const results = flushToolResults();
      const content: ContentBlock[] = [
        ...results,
        { text: msg.content || ' ' },
      ];
      bedMessages.push({ role: 'user', content });
      continue;
    }
    if (msg.role === 'assistant') {
      const results = flushToolResults();
      if (results.length > 0) {
        bedMessages.push({ role: 'user', content: results });
      }
      lastAssistantToolUseIds.clear();
      const content: ContentBlock[] = [];
      if ((msg.content || '').trim()) {
        content.push({ text: msg.content!.trim() });
      }
      for (const tc of msg.toolCalls ?? []) {
        lastAssistantToolUseIds.add(tc.id);
        let input: unknown = {};
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          input = { raw: tc.function.arguments };
        }
        content.push({
          toolUse: {
            toolUseId: tc.id,
            name: tc.function.name,
            input,
          },
        });
      }
      if (content.length === 0) content.push({ text: ' ' });
      bedMessages.push({ role: 'assistant', content });
    }
  }
  const remaining = flushToolResults();
  if (remaining.length > 0) {
    bedMessages.push({ role: 'user', content: remaining });
  }

  const system: SystemContentBlock[] =
    systemText.trim().length > 0 ? [{ text: systemText }] : [];
  return { system, bedMessages };
}

function toolsToBedrock(
  tools: ToolDefinition[]
): ToolConfiguration | undefined {
  if (tools.length === 0) return undefined;
  const bedTools: ToolSpecification[] = tools.map((t) => ({
    toolSpec: {
      name: t.function.name,
      description: t.function.description,
      inputSchema: {
        json: (t.function.parameters as Record<string, unknown>) ?? {
          type: 'object',
          properties: {},
        },
      },
    },
  }));
  return { tools: bedTools, toolChoice: { auto: {} } };
}

export async function chat(
  messages: ChatMessage[],
  options?: {
    model?: string;
    tools?: ToolDefinition[];
    projectRoot?: string;
    signal?: AbortSignal;
  }
): Promise<{
  content: string;
  toolCalls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
}> {
  const projectRoot = options?.projectRoot ?? '';
  const { region, model: defaultModel } = getBedrockEnv(projectRoot);
  const model = options?.model ?? defaultModel;

  const { system, bedMessages } = messagesToBedrock(messages);
  if (bedMessages.length === 0) {
    throw new Error('Bedrock: no messages to send');
  }

  const client = new BedrockRuntimeClient({
    region,
    credentials: fromNodeProviderChain(),
  });

  const toolConfig = options?.tools?.length
    ? toolsToBedrock(options.tools)
    : undefined;

  log.debug('chat request', 'model:', model, 'messages:', messages.length);
  const response = await client.send(
    new ConverseCommand({
      modelId: model,
      messages: bedMessages,
      system: system.length > 0 ? system : undefined,
      inferenceConfig: {
        maxTokens: 4096,
        temperature: 0.7,
        topP: 1,
      },
      toolConfig,
    }),
    options?.signal ? { abortSignal: options.signal } : undefined
  );

  const output = response.output;
  if (!output || !('message' in output)) {
    throw new Error('Bedrock: no message in response');
  }
  const outMessage = output.message;
  const contentBlocks = outMessage.content ?? [];
  let content = '';
  const toolCalls: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }> = [];

  for (const block of contentBlocks) {
    if ('text' in block && block.text) content += block.text;
    if ('toolUse' in block && block.toolUse) {
      const tu = block.toolUse;
      toolCalls.push({
        id: tu.toolUseId,
        type: 'function',
        function: {
          name: tu.name,
          arguments:
            typeof tu.input === 'string'
              ? tu.input
              : JSON.stringify(tu.input ?? {}),
        },
      });
    }
  }

  log.debug('chat response', 'toolCalls:', toolCalls.length);
  return {
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}
