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

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Tooltip } from './Tooltip';
import './Tooltip.css';

type Message = {
  role: string;
  content: string;
  toolCalls?: Array<{
    id: string;
    function: { name: string; arguments: string };
  }>;
};

export function ChatMessage({
  message,
  compact = true,
}: {
  message: Message;
  compact?: boolean;
}) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isTool = message.role === 'tool';

  const showToolResultFull = isTool && !compact;
  const showToolCallsList =
    isAssistant &&
    message.toolCalls &&
    message.toolCalls.length > 0 &&
    !compact;
  const toolCount = message.toolCalls?.length ?? 0;

  return (
    <div className={`chat-message chat-message--${message.role}`}>
      <div className="chat-message__role">{message.role}</div>
      <div className="chat-message__content">
        {isTool ? (
          showToolResultFull ? (
            <pre className="chat-message__tool-result">{message.content}</pre>
          ) : (
            <div className="chat-message__tool-summary">
              Tool output{' '}
              {message.content.length > 0
                ? `(${message.content.length} chars)`
                : '(empty)'}
            </div>
          )
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content || (isAssistant && toolCount > 0 ? '' : '')}
          </ReactMarkdown>
        )}
        {isAssistant &&
          message.toolCalls &&
          message.toolCalls.length > 0 &&
          compact && (
            <div className="chat-message__tool-summary">
              Used {message.toolCalls.length} tool
              {message.toolCalls.length !== 1 ? 's' : ''}
            </div>
          )}
        {showToolCallsList && (
          <div className="chat-message__tool-calls">
            {message.toolCalls!.map((tc) => (
              <div key={tc.id} className="chat-message__tool-call">
                <Tooltip
                  content={
                    tc.function.name === 'add_todo'
                      ? 'Create a TODO item for this task'
                      : tc.function.name === 'update_todo'
                        ? 'Update the status of a TODO item'
                        : tc.function.name === 'list_todos'
                          ? 'View all active TODO items'
                          : ''
                  }
                >
                  <code>{tc.function.name}</code>
                </Tooltip>
                ({tc.function.arguments})
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
