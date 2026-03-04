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

export type WorkLogEntry = {
  type: 'status' | 'tool';
  description?: string;
  toolName?: string;
  resultSummary?: string;
  pending?: boolean;
};

export type ChatMsgForWorkLog = {
  role: string;
  content: string;
  toolCalls?: Array<{
    id: string;
    function: { name: string; arguments: string };
  }>;
  toolCallId?: string;
};

const MAX_WORK_LOG_MESSAGES = 200;

/**
 * Build work log entries from session messages (assistant tool calls + set_status, with tool results).
 */
export function buildWorkLogEntries(messages: ChatMsgForWorkLog[]): WorkLogEntry[] {
  const messagesToProcess = messages.slice(-MAX_WORK_LOG_MESSAGES);
  const entries: WorkLogEntry[] = [];
  for (let i = 0; i < messagesToProcess.length; i++) {
    const msg = messagesToProcess[i];
    if (msg.role !== 'assistant' || !msg.toolCalls?.length) continue;
    for (const tc of msg.toolCalls) {
      let args: { description?: string } = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}') as { description?: string };
      } catch {
        // ignore
      }
      if (tc.function.name === 'set_status') {
        entries.push({
          type: 'status',
          description: args.description ?? '(no description)',
        });
        continue;
      }
      let resultSummary = '';
      for (let j = i + 1; j < messagesToProcess.length; j++) {
        const m = messagesToProcess[j] as ChatMsgForWorkLog;
        if (m.role === 'tool' && m.toolCallId === tc.id) {
          const content = m.content;
          resultSummary = content.length > 80 ? content.slice(0, 77) + '…' : content;
          break;
        }
      }
      entries.push({ type: 'tool', toolName: tc.function.name, resultSummary });
    }
  }
  return entries;
}
