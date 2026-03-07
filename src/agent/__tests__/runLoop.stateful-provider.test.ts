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
 * WITHOUT WARRANTIES OR CONDITIONS OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * See the License for the specific language governing permissions and limitations under the License.
 */

import { describe, it, expect } from 'vitest';
import { getChatMessagesForProvider } from '../runLoop';

const SYSTEM_PROMPT = '[System] You are a helpful assistant.';
const USER_1 = 'First user message';
const ASSISTANT_1 = 'First assistant reply';
const USER_2 = 'Second user message';

describe('getChatMessagesForProvider', () => {
  const providerId = 'cursor';

  it('first turn (no cursor, no provider session id): includes system and first user message', () => {
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const, content: USER_1 },
    ];
    const out = getChatMessagesForProvider({
      messages,
      providerId,
      isSlicedProvider: true,
      providerMessageCursors: undefined,
      providerSessionIds: undefined,
    });
    expect(out).toHaveLength(2);
    expect(out[0].role).toBe('system');
    expect(out[0].content).toBe(SYSTEM_PROMPT);
    expect(out[1].role).toBe('user');
    expect(out[1].content).toBe(USER_1);
  });

  it('first turn with provider session id set but cursor 0: still includes system (initial send)', () => {
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const, content: USER_1 },
    ];
    const out = getChatMessagesForProvider({
      messages,
      providerId,
      isSlicedProvider: true,
      providerMessageCursors: {},
      providerSessionIds: { [providerId]: 'session-123' },
    });
    expect(out).toHaveLength(2);
    expect(out[0].role).toBe('system');
    expect(out[1].role).toBe('user');
  });

  it('resuming (cursor > 0, provider session id set): only new messages, NO system', () => {
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const, content: USER_1 },
      { role: 'assistant' as const, content: ASSISTANT_1 },
      { role: 'user' as const, content: USER_2 },
    ];
    const out = getChatMessagesForProvider({
      messages,
      providerId,
      isSlicedProvider: true,
      providerMessageCursors: { [providerId]: 2 },
      providerSessionIds: { [providerId]: 'session-123' },
    });
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('user');
    expect(out[0].content).toBe(USER_2);
    expect(out.some((m) => m.role === 'system')).toBe(false);
  });

  it('resuming: does not include any prior user or assistant messages', () => {
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const, content: USER_1 },
      { role: 'assistant' as const, content: ASSISTANT_1 },
      { role: 'user' as const, content: USER_2 },
    ];
    const out = getChatMessagesForProvider({
      messages,
      providerId,
      isSlicedProvider: true,
      providerMessageCursors: { [providerId]: 2 },
      providerSessionIds: { [providerId]: 'session-123' },
    });
    const contents = out.map((m) => m.content);
    expect(contents).not.toContain(SYSTEM_PROMPT);
    expect(contents).not.toContain(USER_1);
    expect(contents).not.toContain(ASSISTANT_1);
    expect(contents).toContain(USER_2);
  });

  it('non-sliced provider: always returns full messages (no delta logic)', () => {
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const, content: USER_1 },
      { role: 'assistant' as const, content: ASSISTANT_1 },
      { role: 'user' as const, content: USER_2 },
    ];
    const out = getChatMessagesForProvider({
      messages,
      providerId: 'anthropic',
      isSlicedProvider: false,
      providerMessageCursors: { anthropic: 2 },
      providerSessionIds: { anthropic: 'any' },
    });
    expect(out).toHaveLength(4);
    expect(out[0].role).toBe('system');
    expect(out.map((m) => m.content)).toEqual([SYSTEM_PROMPT, USER_1, ASSISTANT_1, USER_2]);
  });
});

