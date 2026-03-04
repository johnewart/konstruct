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

import React, { useCallback, useEffect, useRef } from 'react';
import { Box, Text, Textarea, Button, ScrollArea } from '@mantine/core';
import { trpc } from '../../client/trpc';
import { ChatMessage } from './ChatMessage';

interface ReviewAssistantPanelProps {
  sessionId: string | null;
}

export function ReviewAssistantPanel({ sessionId }: ReviewAssistantPanelProps) {
  const [input, setInput] = React.useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const utils = trpc.useUtils();

  const { data: session } = trpc.sessions.get.useQuery(
    { id: sessionId! },
    { enabled: !!sessionId }
  );
  const { data: runProgress } = trpc.chat.getRunProgress.useQuery(
    { sessionId: sessionId! },
    {
      enabled: !!sessionId,
      refetchInterval: (q) => (q.state.data?.running ? 400 : false),
    }
  );

  const sendMessage = trpc.chat.sendMessage.useMutation({
    onSuccess: (_data, variables) => {
      utils.sessions.get.invalidate({ id: variables.sessionId });
    },
  });

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [session?.messages?.length, scrollToBottom]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (!text || !sessionId) return;
      sendMessage.mutate({ sessionId, content: text });
      setInput('');
    },
    [input, sessionId, sendMessage]
  );

  const messages = session?.messages ?? [];
  const displayMessages = messages.filter((m) => m.role !== 'system');
  const chatWindowMessages = displayMessages.filter((msg) => {
    if (msg.role === 'tool') return false;
    if (
      msg.role === 'assistant' &&
      msg.toolCalls?.length &&
      !(msg.content?.trim())
    )
      return false;
    return true;
  });

  const isRunning = runProgress?.running === true;

  if (!sessionId) {
    return (
      <Box style={{ padding: 16 }}>
        <Text size="sm" c="dimmed">
          Preparing assistant…
        </Text>
      </Box>
    );
  }

  return (
    <Box
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
      <Text
        size="sm"
        fw={600}
        style={{ padding: '8px 12px', borderBottom: '1px solid var(--app-border)' }}
      >
        Chat about this review
      </Text>
      <ScrollArea
        style={{ flex: 1, minHeight: 0 }}
        viewportProps={{ style: { minHeight: 120 } }}
        type="auto"
      >
        <Box p="xs" style={{ paddingBottom: 4 }}>
          {chatWindowMessages.length === 0 && !isRunning && (
            <Text size="xs" c="dimmed">
              Ask the agent about the diff, suggestions, or any review question.
            </Text>
          )}
          {chatWindowMessages.map((msg, i) => (
            <ChatMessage key={i} message={msg} compact />
          ))}
          {isRunning && (
            <Text size="xs" c="dimmed" fs="italic">
              Thinking…
            </Text>
          )}
          <div ref={messagesEndRef} />
        </Box>
      </ScrollArea>
      <Box component="form" onSubmit={handleSubmit} p="xs" style={{ borderTop: '1px solid var(--app-border)' }}>
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e as unknown as React.FormEvent);
            }
          }}
          placeholder={
            isRunning
              ? 'Agent is working…'
              : 'Ask about this review (Enter to send, Shift+Enter for new line)'
          }
          minRows={1}
          maxRows={3}
          autosize
          disabled={isRunning}
          styles={{ root: { marginBottom: 8 } }}
        />
        <Button
          type="submit"
          size="xs"
          disabled={!input.trim() || isRunning}
          loading={sendMessage.isPending}
        >
          Send
        </Button>
        {sendMessage.isError && (
          <Text size="xs" c="red" mt={4}>
            {sendMessage.error.message}
          </Text>
        )}
      </Box>
    </Box>
  );
}
