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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Group,
  Menu,
  ScrollArea,
  Select,
  Text,
  Textarea,
  Tooltip,
} from '@mantine/core';
import { trpc } from '../../client/trpc';
import { ChatMessage } from './ChatMessage';
import type { ChatMsgForWorkLog } from '../lib/chatWorkLog';

export type UnifiedChatPanelVariant = 'embedded' | 'full';

export interface UnifiedChatPanelProps {
  sessionId: string | null;
  /** When set (e.g. on PR page), the PR is included in agent context. */
  prContext?: { pullNumber: number };
  /** Default mode when none stored (e.g. 'code_reviewer' or 'implementation'). */
  defaultModeId: string;
  /** Prefix for localStorage keys: mode, provider, model (e.g. 'review' or 'chat'). */
  storageKeysPrefix: string;
  variant: UnifiedChatPanelVariant;
  /** Header title when variant is embedded. */
  title?: string;
  /** Shown when there are no messages and agent is not running. */
  emptyPlaceholder?: string;
  /** Show Cancel button in form when agent is running (e.g. full chat). */
  showCancelButton?: boolean;
  /** Optional live progress from WebSocket (used by primary Chat page). */
  liveProgressFromStream?: {
    entries: Array<{
      type: 'status' | 'tool';
      description?: string;
      toolName?: string;
      resultSummary?: string;
      pending?: boolean;
    }>;
    running: boolean;
  } | null;
  /** Optional: transform content before sending (e.g. append attachments). */
  transformContent?: (text: string) => string;
  /** Optional: if returns { send: false }, panel does not send (caller may queue). */
  onBeforeSend?: (text: string) => { send: boolean; content?: string };
}

export function UnifiedChatPanel({
  sessionId,
  prContext,
  defaultModeId,
  storageKeysPrefix,
  variant,
  title = 'Chat',
  emptyPlaceholder = 'Type a message…',
  showCancelButton = false,
  liveProgressFromStream,
  transformContent,
  onBeforeSend,
}: UnifiedChatPanelProps) {
  const [input, setInput] = useState('');
  const [modeId, setModeId] = useState<string>(() => {
    if (typeof window === 'undefined') return defaultModeId;
    return localStorage.getItem(`${storageKeysPrefix}-mode`) || defaultModeId;
  });
  const [providerId, setProviderId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(`${storageKeysPrefix}-provider`);
  });
  const [selectedModelId, setSelectedModelId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(`${storageKeysPrefix}-model`);
  });
  const [selectedRunpodModelId, setSelectedRunpodModelId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(`${storageKeysPrefix}-provider`) === 'runpod'
      ? localStorage.getItem(`${storageKeysPrefix}-model`)
      : null;
  });
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const [runPendingSince, setRunPendingSince] = useState<number | null>(null);
  const [liveProgressFromStreamInternal, setLiveProgressFromStreamInternal] = useState<{
    entries: Array<{ type: 'status' | 'tool'; description?: string; toolName?: string; resultSummary?: string; pending?: boolean }>;
    running: boolean;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const statusBoxRef = useRef<HTMLDivElement>(null);
  const runWasInProgressRef = useRef(false);
  const utils = trpc.useUtils();

  const sendMessage = trpc.chat.sendMessage.useMutation({
    onSuccess: (_data, variables) => {
      setRunPendingSince(Date.now());
      utils.sessions.get.invalidate({ id: variables.sessionId });
    },
  });
  const abortRun = trpc.chat.abortRun.useMutation();

  const waitingForRunStart = runPendingSince != null && Date.now() - runPendingSince < 8000;
  const { data: runProgress } = trpc.chat.getRunProgress.useQuery(
    { sessionId: sessionId! },
    {
      enabled: !!sessionId,
      refetchInterval: (q) =>
        sendMessage.isPending || q.state.data?.running || waitingForRunStart ? 400 : false,
    }
  );
  const streamProgress = liveProgressFromStream ?? liveProgressFromStreamInternal;
  const isRunning =
    sendMessage.isPending ||
    runProgress?.running === true ||
    streamProgress?.running === true ||
    waitingForRunStart;
  const { data: session } = trpc.sessions.get.useQuery(
    { id: sessionId! },
    { enabled: !!sessionId, refetchInterval: isRunning ? 500 : false }
  );
  const { data: modes } = trpc.chat.listModes.useQuery();
  const { data: providersData } = trpc.chat.listProviders.useQuery();
  const { data: defaultPodData } = trpc.runpod.getDefaultRunpodPod.useQuery(undefined, {
    enabled: providerId === 'runpod',
  });
  const { data: runpodModelsData } = trpc.runpod.getRunpodModels.useQuery(
    { podId: defaultPodData?.defaultPodId ?? '' },
    { enabled: providerId === 'runpod' && !!defaultPodData?.defaultPodId }
  );

  const providers = providersData?.providers ?? [];
  const defaultProviderId = providersData?.defaultProviderId ?? '';
  const runpodModels = runpodModelsData?.models ?? [];
  const configuredProviders = useMemo(
    () => providers.filter((p) => (p as { configured?: boolean }).configured === true),
    [providers]
  );

  const allModelOptions = useMemo(() => {
    const list: { providerId: string; providerName: string; modelId: string; modelName: string }[] = [];
    for (const p of configuredProviders) {
      const prov = p as { defaultModel?: string; models?: { id: string; name: string }[] };
      const isRunpod = p.id === 'runpod';
      const models =
        isRunpod && runpodModels.length > 0
          ? runpodModels.map((m) => ({ id: m.id, name: m.name ?? m.id }))
          : prov.models?.length
            ? prov.models
            : prov.defaultModel
              ? [{ id: prov.defaultModel, name: prov.defaultModel }]
              : [];
      const providerType = (p as { type?: string }).type ?? '';
      const isClaudeCliOrSdk = providerType === 'claude_cli' || providerType === 'claude_sdk';
      const modelList =
        models.length > 0
          ? models
          : isClaudeCliOrSdk
            ? [{ id: 'default', name: 'Default' }]
            : [{ id: p.id, name: p.name }];
      for (const m of modelList) {
        list.push({
          providerId: p.id,
          providerName: p.name,
          modelId: m.id,
          modelName: m.name || m.id,
        });
      }
    }
    return list;
  }, [configuredProviders, runpodModels]);

  useEffect(() => {
    if (!providerId && defaultProviderId && configuredProviders.some((p) => p.id === defaultProviderId)) {
      setProviderId(defaultProviderId);
      if (typeof window !== 'undefined') localStorage.setItem(`${storageKeysPrefix}-provider`, defaultProviderId);
    }
  }, [defaultProviderId, configuredProviders, providerId, storageKeysPrefix]);

  const runProgressEntries = streamProgress?.entries ?? runProgress?.entries ?? [];
  /** Live entries to show in the status box (current run only). */
  const statusBoxEntries = runProgressEntries;

  useEffect(() => {
    const running = runProgress?.running === true || streamProgress?.running === true;
    if (runWasInProgressRef.current && !running && sessionId) {
      utils.sessions.get.invalidate({ id: sessionId });
      void utils.sessions.get.refetch({ id: sessionId });
      setPendingUserMessage(null);
    }
    runWasInProgressRef.current = running;
  }, [runProgress?.running, streamProgress?.running, sessionId, utils.sessions.get]);

  // WebSocket for real-time agent progress when using the worker (same as main Chat page)
  useEffect(() => {
    if (!sessionId || typeof window === 'undefined') return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/agent-stream`;
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', sessionId }));
    };
    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string) as {
          sessionId?: string;
          entries?: Array<{ type: 'status' | 'tool'; description?: string; toolName?: string; resultSummary?: string; pending?: boolean }>;
          running?: boolean;
          done?: boolean;
        };
        if (data.sessionId !== sessionId) return;
        if (data.done) {
          setLiveProgressFromStreamInternal(null);
          setRunPendingSince(null);
          utils.sessions.get.invalidate({ id: sessionId });
          void utils.sessions.get.refetch({ id: sessionId });
          return;
        }
        setLiveProgressFromStreamInternal({
          entries: data.entries ?? [],
          running: data.running ?? false,
        });
      } catch {
        // ignore
      }
    };
    ws.onclose = () => setLiveProgressFromStreamInternal(null);
    return () => {
      ws.close();
      setLiveProgressFromStreamInternal(null);
    };
  }, [sessionId, utils.sessions.get]);

  useEffect(() => {
    if (runProgress?.running === true || streamProgress?.running === true) setRunPendingSince(null);
  }, [runProgress?.running, streamProgress?.running]);
  useEffect(() => {
    if (runPendingSince == null) return;
    const t = setTimeout(() => setRunPendingSince(null), 8000);
    return () => clearTimeout(t);
  }, [runPendingSince]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);
  useEffect(() => {
    scrollToBottom();
  }, [session?.messages?.length, pendingUserMessage, scrollToBottom]);

  useEffect(() => {
    const el = statusBoxRef.current;
    if (!el || !isRunning) return;
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [isRunning, statusBoxEntries.length]);

  const messages = session?.messages ?? [];
  const displayMessages = messages.filter((m) => m.role !== 'system');
  const displayMessagesWithPending = useMemo(() => {
    if (!pendingUserMessage) return displayMessages;
    return [
      ...displayMessages,
      { role: 'user', content: pendingUserMessage } as ChatMsgForWorkLog & { role: 'user'; content: string },
    ];
  }, [displayMessages, pendingUserMessage]);

  const chatWindowMessages = useMemo(
    () =>
      displayMessagesWithPending.filter((msg) => {
        if (msg.role === 'tool') return false;
        if (
          msg.role === 'assistant' &&
          msg.toolCalls?.length &&
          !(msg.content?.trim())
        )
          return false;
        return true;
      }),
    [displayMessagesWithPending]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (!text || !sessionId) return;

      const content = transformContent ? transformContent(text) : text;
      if (onBeforeSend) {
        const result = onBeforeSend(text);
        if (!result.send) return;
        const toSend = result.content ?? content;
        setPendingUserMessage(toSend);
        setInput('');
        sendMessage.mutate({
          sessionId,
          content: toSend,
          modeId: modeId || defaultModeId,
          providerId: (providerId ?? defaultProviderId) || undefined,
          ...(providerId === 'runpod' && selectedRunpodModelId
            ? { model: selectedRunpodModelId }
            : selectedModelId
              ? { model: selectedModelId }
              : {}),
          ...(prContext ? { prContext: { pullNumber: prContext.pullNumber } } : {}),
        });
        return;
      }

      setPendingUserMessage(content);
      sendMessage.mutate({
        sessionId,
        content,
        modeId: modeId || defaultModeId,
        providerId: (providerId ?? defaultProviderId) || undefined,
        ...(providerId === 'runpod' && selectedRunpodModelId
          ? { model: selectedRunpodModelId }
          : selectedModelId
            ? { model: selectedModelId }
            : {}),
        ...(prContext ? { prContext: { pullNumber: prContext.pullNumber } } : {}),
      });
      setInput('');
    },
    [
      input,
      sessionId,
      modeId,
      defaultModeId,
      providerId,
      defaultProviderId,
      selectedModelId,
      selectedRunpodModelId,
      prContext,
      sendMessage,
      transformContent,
      onBeforeSend,
    ]
  );

  const handleCancel = useCallback(() => {
    if (sessionId) abortRun.mutate({ sessionId });
  }, [sessionId, abortRun]);

  const handleModeChange = (value: string | null) => {
    const next = value || defaultModeId;
    setModeId(next);
    if (typeof window !== 'undefined') localStorage.setItem(`${storageKeysPrefix}-mode`, next);
  };

  const handleModelSelect = (opt: { providerId: string; modelId: string }) => {
    setProviderId(opt.providerId);
    if (opt.providerId === 'runpod') {
      setSelectedRunpodModelId(opt.modelId);
    } else {
      setSelectedModelId(opt.modelId);
    }
    if (typeof window !== 'undefined') {
      localStorage.setItem(`${storageKeysPrefix}-provider`, opt.providerId);
      localStorage.setItem(`${storageKeysPrefix}-model`, opt.modelId);
    }
  };

  const currentModelLabel =
    providerId && allModelOptions.length > 0
      ? (() => {
          const modelId =
            providerId === 'runpod'
              ? selectedRunpodModelId ?? allModelOptions.find((o) => o.providerId === 'runpod')?.modelId
              : selectedModelId ?? allModelOptions.find((o) => o.providerId === providerId)?.modelId;
          const opt = allModelOptions.find((o) => o.providerId === providerId && o.modelId === modelId);
          return opt ? `${opt.providerName}: ${opt.modelName}` : '—';
        })()
      : '—';

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
      {/* Header: title + mode + model */}
      <Group
        justify="space-between"
        align="center"
        gap="xs"
        wrap="nowrap"
        style={{ padding: '6px 10px', borderBottom: '1px solid var(--app-border)', flexShrink: 0 }}
      >
        <Text size="xs" fw={600} style={{ flexShrink: 0 }}>
          {title}
        </Text>
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          {modes && modes.length > 0 && (
            <Select
              size="xs"
              data={modes.map((m) => ({ value: m.id, label: m.name }))}
              value={modeId}
              onChange={handleModeChange}
              styles={{ root: { minWidth: 100, maxWidth: 120 } }}
              aria-label="Mode"
            />
          )}
          <Menu position="bottom-end" width={260} shadow="md">
            <Menu.Target>
              <Tooltip label="Model">
                <Button
                  size="xs"
                  variant="subtle"
                  compact
                  style={{
                    minWidth: 0,
                    maxWidth: 110,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    fontSize: '0.7rem',
                    padding: '2px 6px',
                    height: 22,
                  }}
                >
                  {currentModelLabel}
                </Button>
              </Tooltip>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Provider / Model</Menu.Label>
              {allModelOptions.length === 0 ? (
                <Menu.Item disabled>No models available</Menu.Item>
              ) : (
                allModelOptions.map((opt) => {
                  const isSelected =
                    providerId === opt.providerId &&
                    (opt.providerId === 'runpod'
                      ? selectedRunpodModelId === opt.modelId
                      : selectedModelId === opt.modelId);
                  return (
                    <Menu.Item
                      key={`${opt.providerId}:${opt.modelId}`}
                      onClick={() => handleModelSelect({ providerId: opt.providerId, modelId: opt.modelId })}
                      style={{ fontWeight: isSelected ? 600 : undefined }}
                    >
                      {opt.providerName}: {opt.modelName}
                    </Menu.Item>
                  );
                })
              )}
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      {/* Messages + tool status + Thinking */}
      <ScrollArea
        style={{ flex: 1, minHeight: 0 }}
        viewportProps={{ style: { minHeight: 120 } }}
        type="auto"
      >
        <Box
          p="xs"
          style={{
            paddingBottom: 4,
            fontSize: variant === 'embedded' ? '0.8125rem' : undefined,
          }}
        >
          {chatWindowMessages.length === 0 && !isRunning && (
            <Text size="sm" c="dimmed">
              {emptyPlaceholder}
            </Text>
          )}
          <div className="chat-messages-wrap" style={{ marginTop: 4 }}>
            <div className="chat-messages" ref={chatMessagesRef}>
              {chatWindowMessages.slice(-100).map((msg, i) => (
                <ChatMessage key={i} message={msg} compact />
              ))}
              {isRunning && (
                <div
                  className="chat-status-box"
                  ref={statusBoxRef}
                  role="status"
                  aria-live="polite"
                  style={{ marginTop: 8 }}
                >
                  {statusBoxEntries.length > 0 && (
                    <div className="chat-tool-status-list">
                      {statusBoxEntries.map((entry, i) => (
                        <div
                          key={i}
                          className={`chat-tool-status ${entry.pending ? 'chat-tool-status--pending' : ''}`}
                        >
                          <span className="chat-tool-status__indicator" aria-hidden>
                            {entry.pending ? '○' : '●'}
                          </span>
                          <span className="chat-tool-status__text">
                            {entry.type === 'status'
                              ? entry.description
                              : entry.description ?? entry.toolName}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="chat-thinking" aria-busy="true">
                    <span className="chat-thinking__spinner" aria-hidden />
                    <span className="chat-thinking__text">Thinking…</span>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div ref={messagesEndRef} />
        </Box>
      </ScrollArea>

      {/* Form */}
      <Box p="xs" style={{ borderTop: '1px solid var(--app-border)', flexShrink: 0 }}>
        <Box component="form" onSubmit={handleSubmit}>
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
              isRunning ? 'Agent is working…' : `${emptyPlaceholder} (Enter to send, Shift+Enter for new line)`
            }
            minRows={variant === 'embedded' ? 1 : 2}
            maxRows={variant === 'embedded' ? 3 : 6}
            autosize
            disabled={isRunning}
            styles={{
              root: { marginBottom: 8 },
              input: { fontSize: variant === 'embedded' ? '0.8125rem' : '1.05rem' },
            }}
          />
          <Group gap="xs">
            <Button
              type="submit"
              size={variant === 'embedded' ? 'xs' : 'sm'}
              disabled={!input.trim() || isRunning}
              loading={sendMessage.isPending}
            >
              Send
            </Button>
            {showCancelButton && isRunning && (
              <Button type="button" variant="default" onClick={handleCancel} aria-label="Cancel">
                Cancel
              </Button>
            )}
          </Group>
          {sendMessage.isError && (
            <Text size="xs" c="red" mt={4}>
              {sendMessage.error.message}
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
