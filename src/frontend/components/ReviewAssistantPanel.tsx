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
import { Box, Text, Textarea, Button, ScrollArea, Select, Menu, Tooltip, Group } from '@mantine/core';
import { trpc } from '../../client/trpc';
import { ChatMessage } from './ChatMessage';

const REVIEW_MODE_KEY = 'konstruct-review-mode';
const REVIEW_PROVIDER_KEY = 'konstruct-review-provider';
const REVIEW_MODEL_KEY = 'konstruct-review-model';

const DEFAULT_MODE_ID = 'code_reviewer';

interface ReviewAssistantPanelProps {
  sessionId: string | null;
  /** When set (e.g. on PR page), the PR is included in agent context. */
  prContext?: { pullNumber: number };
}

export function ReviewAssistantPanel({ sessionId, prContext }: ReviewAssistantPanelProps) {
  const [input, setInput] = useState('');
  const [modeId, setModeId] = useState<string>(() => {
    if (typeof window === 'undefined') return DEFAULT_MODE_ID;
    return localStorage.getItem(REVIEW_MODE_KEY) || DEFAULT_MODE_ID;
  });
  const [providerId, setProviderId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(REVIEW_PROVIDER_KEY);
  });
  const [selectedModelId, setSelectedModelId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(REVIEW_MODEL_KEY);
  });
  const [selectedRunpodModelId, setSelectedRunpodModelId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(REVIEW_PROVIDER_KEY) === 'runpod' ? localStorage.getItem(REVIEW_MODEL_KEY) : null;
  });
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
      const modelList = models.length > 0 ? models : [{ id: p.id, name: p.name }];
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
      if (typeof window !== 'undefined') localStorage.setItem(REVIEW_PROVIDER_KEY, defaultProviderId);
    }
  }, [defaultProviderId, configuredProviders, providerId]);

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
      const effectiveProvider = providerId ?? defaultProviderId;
      const effectiveModel =
        effectiveProvider === 'runpod'
          ? selectedRunpodModelId ?? allModelOptions.find((o) => o.providerId === 'runpod')?.modelId
          : selectedModelId ?? allModelOptions.find((o) => o.providerId === effectiveProvider)?.modelId;
      sendMessage.mutate({
        sessionId,
        content: text,
        modeId: modeId || DEFAULT_MODE_ID,
        providerId: effectiveProvider || undefined,
        ...(effectiveModel ? { model: effectiveModel } : {}),
        ...(prContext ? { prContext: { pullNumber: prContext.pullNumber } } : {}),
      });
      setInput('');
    },
    [
      input,
      sessionId,
      sendMessage,
      modeId,
      providerId,
      defaultProviderId,
      selectedModelId,
      selectedRunpodModelId,
      allModelOptions,
      prContext,
    ]
  );

  const handleModeChange = (value: string | null) => {
    const next = value || DEFAULT_MODE_ID;
    setModeId(next);
    if (typeof window !== 'undefined') localStorage.setItem(REVIEW_MODE_KEY, next);
  };

  const handleModelSelect = (opt: { providerId: string; modelId: string }) => {
    setProviderId(opt.providerId);
    if (opt.providerId === 'runpod') {
      setSelectedRunpodModelId(opt.modelId);
    } else {
      setSelectedModelId(opt.modelId);
    }
    if (typeof window !== 'undefined') {
      localStorage.setItem(REVIEW_PROVIDER_KEY, opt.providerId);
      localStorage.setItem(REVIEW_MODEL_KEY, opt.modelId);
    }
  };

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
      <Group
        justify="space-between"
        align="center"
        gap="xs"
        wrap="nowrap"
        style={{ padding: '6px 10px', borderBottom: '1px solid var(--app-border)' }}
      >
        <Text size="xs" fw={600} style={{ flexShrink: 0 }}>
          Chat about this review
        </Text>
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          {modes && modes.length > 0 && (
            <Select
              size="xs"
              data={modes.map((m) => ({ value: m.id, label: m.name }))}
              value={modeId}
              onChange={handleModeChange}
              styles={{ root: { minWidth: 100, maxWidth: 120 } }}
              aria-label="Assistant"
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
      <ScrollArea
        className="review-assistant-chat"
        style={{ flex: 1, minHeight: 0 }}
        viewportProps={{ style: { minHeight: 120 } }}
        type="auto"
      >
        <Box p="xs" style={{ paddingBottom: 4 }}>
          {chatWindowMessages.length === 0 && !isRunning && (
            <Text size="sm" c="dimmed">
              Ask the agent about the diff, suggestions, or any review question.
            </Text>
          )}
          {chatWindowMessages.map((msg, i) => (
            <ChatMessage key={i} message={msg} compact />
          ))}
          {isRunning && (
            <Text size="sm" c="dimmed" fs="italic">
              Thinking…
            </Text>
          )}
          <div ref={messagesEndRef} />
        </Box>
      </ScrollArea>
      <Box p="xs" className="review-assistant-chat" style={{ borderTop: '1px solid var(--app-border)' }}>
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
              isRunning
                ? 'Agent is working…'
                : 'Ask about this review (Enter to send, Shift+Enter for new line)'
            }
            minRows={1}
            maxRows={3}
            autosize
            disabled={isRunning}
            styles={{ root: { marginBottom: 8 }, input: { fontSize: '1.05rem' } }}
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
    </Box>
  );
}
