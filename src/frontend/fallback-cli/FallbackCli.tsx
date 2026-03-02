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

/**
 * Embedded CLI fallback when the main UI cannot render.
 * Isolated: only imports trpc client and minimal Mantine. No main app imports.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Button, Text, Stack, TextInput, Paper } from '@mantine/core';
import { IconRefresh, IconSend } from '@tabler/icons-react';
import { trpc } from '../../client/trpc';

type OutLine = { type: 'out' | 'err' | 'sys'; text: string };

const HELP_TEXT = `Commands:
  /help     - Show this help
  /list     - List sessions (latest first)
  /switch   - Switch session (e.g. /switch <session_id>)
  /new      - New session (optional: /new <title>)
  /clear    - Clear this output
  /reload   - Reload the full app

Otherwise type a message and press Enter to send.`;

function useLatestSession() {
  const list = trpc.sessions.list.useQuery();
  const create = trpc.sessions.create.useMutation();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string>('');
  const createdRef = useRef(false);

  useEffect(() => {
    if (list.isLoading || !list.data) return;
    const sessions = list.data;
    if (sessions.length > 0) {
      const latest = sessions[0] as { id: string; title: string };
      setSessionId(latest.id);
      setSessionTitle(latest.title ?? latest.id);
      return;
    }
    if (createdRef.current) return;
    createdRef.current = true;
    create.mutate(
      { title: 'Fallback CLI' },
      {
        onSuccess: (s) => {
          setSessionId(s.id);
          setSessionTitle(s.title ?? s.id);
        },
      }
    );
  }, [list.data, list.isLoading, create]);

  return {
    sessionId,
    sessionTitle,
    setSessionId,
    setSessionTitle,
    sessions: list.data ?? [],
    isLoading: list.isLoading,
    refetchSessions: list.refetch,
  };
}

export function FallbackCli() {
  const [lines, setLines] = useState<OutLine[]>(() => [
    { type: 'sys', text: 'Fallback CLI — main UI failed to render. Continue here or /reload to try the app again.' },
    { type: 'sys', text: '' },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const outputEndRef = useRef<HTMLDivElement>(null);

  const {
    sessionId,
    sessionTitle,
    setSessionId,
    setSessionTitle,
    sessions,
    isLoading: sessionsLoading,
    refetchSessions,
  } = useLatestSession();

  const createSession = trpc.sessions.create.useMutation();

  const getSession = trpc.sessions.get.useQuery(
    { id: sessionId! },
    { enabled: !!sessionId }
  );
  const sendMessage = trpc.chat.sendMessage.useMutation();
  const utils = trpc.useUtils();

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  const append = useCallback((type: OutLine['type'], text: string) => {
    setLines((prev) => [...prev, { type, text }]);
  }, []);

  const pollForNewMessages = useCallback(
    async (afterIndex: number) => {
      if (!sessionId) return;
      const maxAttempts = 30;
      const interval = 500;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, interval));
        const session = await utils.sessions.get.fetch({ id: sessionId });
        const messages = (session?.messages ?? []).filter(
          (m: { role: string }) => m.role !== 'system'
        );
        const newMessages = messages.slice(afterIndex);
        for (const msg of newMessages) {
          const role = (msg as { role: string }).role;
          const content = (msg as { content: string }).content ?? '';
          if (role === 'assistant' && content) append('out', `agent: ${content}`);
          if (role === 'user') append('sys', `you: ${content}`);
        }
        if (newMessages.some((m: { role: string }) => m.role === 'assistant'))
          break;
      }
    },
    [sessionId, utils.sessions.get, append]
  );

  const handleSend = useCallback(() => {
    const line = input.trim();
    setInput('');
    if (!line) return;

    if (line.startsWith('/')) {
      const parts = line.slice(1).trim().split(/\s+/);
      const cmd = (parts[0] ?? '').toLowerCase();
      const args = parts.slice(1).join(' ');

      switch (cmd) {
        case 'help':
          append('sys', HELP_TEXT);
          return;
        case 'list': {
          if (sessions.length === 0) {
            append('sys', 'No sessions.');
            return;
          }
          append('sys', 'Sessions (latest first):');
          sessions.forEach((s: { id: string; title: string }) => {
            append('sys', `  ${s.id}  ${s.title ?? s.id}`);
          });
          return;
        }
        case 'switch': {
          const id = args.trim();
          if (!id) {
            append('err', 'Usage: /switch <session_id>');
            return;
          }
          const found = sessions.find((s: { id: string }) => s.id === id);
          if (found) {
            setSessionId(id);
            setSessionTitle((found as { title: string }).title ?? id);
            append('sys', `Switched to ${id}`);
          } else {
            append('err', `Session not found: ${id}. Use /list to see IDs.`);
          }
          return;
        }
        case 'new': {
          const title = args.trim() || 'Fallback CLI';
          createSession.mutate(
            { title },
            {
              onSuccess: (s) => {
                setSessionId(s.id);
                setSessionTitle(s.title ?? s.id);
                append('sys', `Created session: ${s.id}`);
                refetchSessions();
              },
              onError: (e) => append('err', e.message),
            }
          );
          return;
        }
        case 'clear':
          setLines([]);
          return;
        case 'reload':
          window.location.reload();
          return;
        default:
          append('err', `Unknown command: /${cmd}. Type /help.`);
          return;
      }
    }

    if (!sessionId) {
      append('err', 'No session. Wait for one to load or run /new.');
      return;
    }

    setSending(true);
    const messageCountBefore = (getSession.data?.messages ?? []).length;

    sendMessage.mutate(
      {
        sessionId,
        content: line,
        modeId: 'implementation',
      },
      {
        onSuccess: () => {
          append('sys', `you: ${line}`);
          pollForNewMessages(messageCountBefore);
        },
        onError: (e) => {
          append('err', e.message);
        },
        onSettled: () => {
          setSending(false);
          utils.sessions.get.invalidate({ id: sessionId });
        },
      }
    );
  }, [
    input,
    sessionId,
    sessions,
    getSession.data?.messages?.length,
    sendMessage,
    append,
    refetchSessions,
    pollForNewMessages,
    utils.sessions.get,
    createSession,
    setSessionId,
    setSessionTitle,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Box
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--mantine-color-default)',
      }}
    >
      <Paper p="sm" radius={0} withBorder style={{ borderLeft: 0, borderRight: 0, borderTop: 0 }}>
        <Stack gap="xs">
          <Text size="sm" fw={600}>Fallback CLI</Text>
          <Text size="xs" c="dimmed">
            Session: {sessionId ? `${sessionTitle} (${sessionId})` : sessionsLoading ? 'Loading…' : 'None — use /new'}
          </Text>
          <Button
            size="xs"
            variant="light"
            leftSection={<IconRefresh size={14} />}
            onClick={() => window.location.reload()}
          >
            Reload full app
          </Button>
        </Stack>
      </Paper>
      <Box
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 12,
          fontFamily: 'ui-monospace, monospace',
          fontSize: 13,
        }}
      >
        {lines.map((l, i) => (
          <Text
            key={i}
            component="pre"
            size="sm"
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: l.type === 'err' ? 'var(--mantine-color-red-7)' : l.type === 'sys' ? 'var(--mantine-color-dimmed)' : undefined,
            }}
          >
            {l.text}
          </Text>
        ))}
        <div ref={outputEndRef} />
      </Box>
      <Paper p="sm" radius={0} withBorder style={{ borderLeft: 0, borderRight: 0, borderBottom: 0 }}>
        <Stack gap="xs">
          <TextInput
            placeholder="Message or /help, /list, /switch, /new, /clear, /reload"
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            disabled={sending}
          />
          <Button
            size="xs"
            leftSection={<IconSend size={14} />}
            onClick={handleSend}
            loading={sending}
          >
            Send
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}