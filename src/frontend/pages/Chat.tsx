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

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
const RUNPOD_CONFIG_KEY = 'runpod-config';
const RUNPOD_CHAT_MODEL_KEY = 'runpod-chat-model';
const CHAT_PROVIDER_KEY = 'chat-provider-id';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { trpc } from '../../client/trpc';
import { ChatMessage } from '../components/ChatMessage';
import {
  Accordion,
  ScrollArea,
  Select,
  Button,
  Textarea,
  TextInput,
  ActionIcon,
  Group,
  Tooltip,
  Text,
} from '@mantine/core';
import { IconPlayerPlay, IconPlayerStop } from '@tabler/icons-react';

const MAX_CONTEXT_TOKENS = 200_000;
const CHARS_PER_TOKEN_ESTIMATE = 4;
const SYSTEM_PROMPT_ESTIMATE_TOKENS = 2_000;

type ChatMsg = {
  role: string;
  content: string;
  toolCalls?: Array<{
    id: string;
    function: { name: string; arguments: string };
  }>;
  toolCallId?: string;
};

function estimateMessageTokens(msg: ChatMsg): number {
  let chars = msg.content?.length ?? 0;
  if (msg.toolCalls) {
    for (const tc of msg.toolCalls)
      chars +=
        (tc.function?.name?.length ?? 0) +
        (tc.function?.arguments?.length ?? 0);
  }
  return Math.ceil(chars / CHARS_PER_TOKEN_ESTIMATE);
}

function buildWorkLogEntries(messages: ChatMsg[]): Array<{
  type: 'status' | 'tool';
  description?: string;
  toolName?: string;
  resultSummary?: string;
  pending?: boolean;
}> {
  const entries: Array<{
    type: 'status' | 'tool';
    description?: string;
    toolName?: string;
    resultSummary?: string;
    pending?: boolean;
  }> = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || !msg.toolCalls?.length) continue;
    for (const tc of msg.toolCalls) {
      let args: { description?: string } = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}') as {
          description?: string;
        };
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
      for (let j = i + 1; j < messages.length; j++) {
        const m = messages[j] as ChatMsg;
        if (m.role === 'tool' && m.toolCallId === tc.id) {
          const content = m.content;
          resultSummary =
            content.length > 80 ? content.slice(0, 77) + '…' : content;
          break;
        }
      }
      entries.push({ type: 'tool', toolName: tc.function.name, resultSummary });
    }
  }
  return entries;
}

export function Chat() {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [todoInput, setTodoInput] = useState('');
  const [modeId, setModeId] = useState('implementation');
  const [providerId, setProviderId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(CHAT_PROVIDER_KEY);
  });
  const [contextModalOpen, setContextModalOpen] = useState(false);
  const [transcriptModalOpen, setTranscriptModalOpen] = useState(false);
  const [planModalName, setPlanModalName] = useState<string | null>(null);
  const [ruleModalName, setRuleModalName] = useState<string | null>(null);
  const [ruleEditContent, setRuleEditContent] = useState('');
  const [newRuleName, setNewRuleName] = useState('');
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(
    null
  );
  const [planToAttach, setPlanToAttach] = useState<string | null>(null);
  // State for session renaming
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitleInHeader, setEditingTitleInHeader] = useState(false);
  const [newSessionTitle, setNewSessionTitle] = useState('');

  type PlanAttachment = { type: 'plan'; name: string; content: string };
  const [attachmentsBySession, setAttachmentsBySession] = useState<
    Record<string, PlanAttachment[]>
  >({});
  const attachments = sessionId ? (attachmentsBySession[sessionId] ?? []) : [];
  const setAttachments = useCallback(
    (
      update: PlanAttachment[] | ((prev: PlanAttachment[]) => PlanAttachment[])
    ) => {
      if (!sessionId) return;
      setAttachmentsBySession((prev) => {
        const current = prev[sessionId] ?? [];
        const next = typeof update === 'function' ? update(current) : update;
        return { ...prev, [sessionId]: next };
      });
    },
    [sessionId]
  );
  const sendAbortRef = useRef<AbortController | null>(null);
  const chatMessagesRef = useRef<HTMLDivElement | null>(null);
  const workLogRef = useRef<HTMLDivElement | null>(null);
  const statusBoxRef = useRef<HTMLDivElement | null>(null);
  const runWasInProgressRef = useRef(false);
  type LiveProgress = {
    entries: Array<{
      type: 'status' | 'tool';
      description?: string;
      toolName?: string;
      resultSummary?: string;
      pending?: boolean;
    }>;
    running: boolean;
  };
  const [liveProgressFromStream, setLiveProgressFromStream] =
    useState<LiveProgress | null>(null);
  // After sending, stay "thinking" until we see run start (stream/poll) or 8s timeout, so we don't flash Ready before the worker reports
  const [runPendingSince, setRunPendingSince] = useState<number | null>(null);
  // When user clicks Cancel, stop showing "thinking" until the next send (worker may still run in background)
  const [runCancelled, setRunCancelled] = useState(false);

  const utils = trpc.useUtils();
  const { data: modes } = trpc.chat.listModes.useQuery();
  const { data: providersData } = trpc.chat.listProviders.useQuery();
  const providers = providersData?.providers ?? [];
  const defaultProviderId = providersData?.defaultProviderId ?? 'openai';
  const { data: defaultPodData } = trpc.runpod.getDefaultRunpodPod.useQuery(
    undefined,
    {
      enabled: providerId === 'runpod',
    }
  );
  const getPodsMutation = trpc.runpod.getPods.useMutation();
  const startPodMutation = trpc.runpod.startPod.useMutation();
  const stopPodMutation = trpc.runpod.stopPod.useMutation();
  const [runpodPods, setRunpodPods] = useState<
    Array<{ id: string; name?: string; status?: string }>
  >([]);
  const [runpodConfigMissing, setRunpodConfigMissing] = useState(false);
  const defaultPodId = defaultPodData?.defaultPodId ?? null;
  const defaultPod = useMemo(
    () =>
      defaultPodId && runpodPods.length
        ? runpodPods.find((p) => p.id === defaultPodId)
        : null,
    [defaultPodId, runpodPods]
  );
  const runpodStatus = defaultPod?.status?.toUpperCase() ?? null;
  const runpodIsRunning = runpodStatus === 'RUNNING';
  const runpodCanStart =
    defaultPod &&
    runpodStatus !== 'RUNNING' &&
    runpodStatus !== 'TERMINATING' &&
    runpodStatus !== 'PENDING';
  const runpodCanStop = defaultPod && runpodIsRunning;
  const { data: runpodV1Connectivity, isFetching: runpodV1Fetching } =
    trpc.runpod.checkRunpodV1Connectivity.useQuery(
      { podId: defaultPodId ?? '' },
      {
        enabled: providerId === 'runpod' && !!defaultPodId && runpodIsRunning,
        refetchInterval: 15000,
      }
    );
  const { data: runpodModelsData } = trpc.runpod.getRunpodModels.useQuery(
    { podId: defaultPodId ?? '' },
    { enabled: providerId === 'runpod' && !!defaultPodId && runpodIsRunning }
  );
  const runpodModels = runpodModelsData?.models ?? [];
  const [selectedRunpodModelId, setSelectedRunpodModelId] = useState<
    string | null
  >(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(RUNPOD_CHAT_MODEL_KEY);
  });
  useEffect(() => {
    if (runpodModels.length === 0) return;
    const current = selectedRunpodModelId;
    const inList = current && runpodModels.some((m) => m.id === current);
    if (!inList) {
      const first = runpodModels[0]?.id ?? null;
      setSelectedRunpodModelId(first);
      if (first) localStorage.setItem(RUNPOD_CHAT_MODEL_KEY, first);
    }
  }, [runpodModels, selectedRunpodModelId]);
  useEffect(() => {
    if (providers.length === 0) return;
    const inList =
      providerId != null && providers.some((p) => p.id === providerId);
    if (inList) return;
    const next =
      defaultProviderId && providers.some((p) => p.id === defaultProviderId)
        ? defaultProviderId
        : providers[0].id;
    setProviderId(next);
    if (typeof window !== 'undefined')
      localStorage.setItem(CHAT_PROVIDER_KEY, next);
  }, [providers, defaultProviderId, providerId]);
  useEffect(() => {
    if (providerId !== 'runpod' || !defaultPodId) {
      setRunpodPods([]);
      setRunpodConfigMissing(false);
      return;
    }
    const raw = localStorage.getItem(RUNPOD_CONFIG_KEY);
    if (!raw) {
      setRunpodConfigMissing(true);
      setRunpodPods([]);
      return;
    }
    setRunpodConfigMissing(false);
    try {
      const config = JSON.parse(raw) as { apiKey?: string; endpoint?: string };
      if (!config?.apiKey?.trim()) {
        setRunpodConfigMissing(true);
        setRunpodPods([]);
        return;
      }
      getPodsMutation.mutate(
        { apiKey: config.apiKey, endpoint: config.endpoint },
        {
          onSuccess: (res) => {
            if (res.success && res.pods) setRunpodPods(res.pods);
            else setRunpodPods([]);
          },
          onError: () => setRunpodPods([]),
        }
      );
    } catch {
      setRunpodConfigMissing(true);
      setRunpodPods([]);
    }
  }, [providerId, defaultPodId]);
  const { data: sessions, refetch: refetchSessions } =
    trpc.sessions.list.useQuery();
  const sendMessage = trpc.chat.sendMessage.useMutation({
    mutationFn: (input: {
      sessionId: string;
      content: string;
      modeId?: string;
      providerId?: string;
      model?: string;
    }) => {
      const signal = sendAbortRef.current?.signal;
      return (
        utils.client as {
          chat: {
            sendMessage: {
              mutate: (
                input: typeof input,
                opts?: { signal?: AbortSignal }
              ) => Promise<unknown>;
            };
          };
        }
      ).chat.sendMessage.mutate(input, signal ? { signal } : undefined);
    },
    onSuccess: () => {
      setRunCancelled(false);
      setRunPendingSince(Date.now());
      if (sessionId) utils.sessions.get.invalidate({ id: sessionId });
      utils.chat.listPlans.invalidate();
      utils.chat.listRules.invalidate();
    },
    onSettled: () => {
      sendAbortRef.current = null;
      setPendingUserMessage(null);
    },
  });
  const abortRun = trpc.chat.abortRun.useMutation();
  const waitingForRunStart =
    runPendingSince !== null && Date.now() - runPendingSince < 8000;
  const { data: runProgress } = trpc.chat.getRunProgress.useQuery(
    { sessionId: sessionId! },
    {
      enabled: !!sessionId,
      refetchInterval: (query) =>
        sendMessage.isPending || query.state.data?.running || waitingForRunStart
          ? 400
          : false,
    }
  );
  const {
    data: session,
    isLoading,
    error,
    refetch,
  } = trpc.sessions.get.useQuery(
    { id: sessionId! },
    {
      enabled: !!sessionId,
      refetchInterval: runProgress?.running ? 500 : false,
    }
  );

  // When agent run finishes (running goes true -> false), refetch session so UI shows final messages
  useEffect(() => {
    const running = runProgress?.running === true;
    if (runWasInProgressRef.current && !running && sessionId) {
      utils.sessions.get.invalidate({ id: sessionId });
      void utils.sessions.get.refetch({ id: sessionId });
    }
    runWasInProgressRef.current = running;
  }, [runProgress?.running, sessionId, utils.sessions.get]);

  // WebSocket for real-time agent progress when using the worker
  useEffect(() => {
    if (!sessionId) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/agent-stream`;
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', sessionId }));
    };
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as {
          sessionId?: string;
          entries?: LiveProgress['entries'];
          running?: boolean;
          done?: boolean;
        };
        if (data.sessionId !== sessionId) return;
        if (data.done) {
          setLiveProgressFromStream(null);
          setRunPendingSince(null);
          utils.sessions.get.invalidate({ id: sessionId });
          void utils.sessions.get.refetch({ id: sessionId });
          return;
        }
        setLiveProgressFromStream({
          entries: data.entries ?? [],
          running: data.running ?? false,
        });
      } catch {
        // ignore
      }
    };
    ws.onclose = () => setLiveProgressFromStream(null);
    return () => {
      ws.close();
      setLiveProgressFromStream(null);
    };
  }, [sessionId, utils.sessions.get]);

  // Clear "waiting for run" once we see running from stream/poll or after 8s
  useEffect(() => {
    if (
      runProgress?.running === true ||
      liveProgressFromStream?.running === true
    ) {
      setRunPendingSince(null);
    }
  }, [runProgress?.running, liveProgressFromStream?.running]);
  useEffect(() => {
    if (runPendingSince == null) return;
    const t = setTimeout(() => setRunPendingSince(null), 8000);
    return () => clearTimeout(t);
  }, [runPendingSince]);

  const { data: contextData, isLoading: contextLoading } =
    trpc.chat.getContext.useQuery(
      { sessionId: sessionId!, modeId },
      { enabled: contextModalOpen && !!sessionId }
    );

  const { data: plans } = trpc.chat.listPlans.useQuery();
  const { data: planContent, isLoading: planContentLoading } =
    trpc.chat.getPlanContent.useQuery(
      { name: planModalName! },
      { enabled: !!planModalName }
    );

  const { data: rules } = trpc.chat.listRules.useQuery();
  const isNewRule = ruleModalName === '__new__';
  const { data: ruleContent, isLoading: ruleContentLoading } =
    trpc.chat.getRuleContent.useQuery(
      { name: ruleModalName! },
      { enabled: !!ruleModalName && ruleModalName !== '__new__' }
    );
  const saveRule = trpc.chat.saveRule.useMutation({
    onSuccess: () => {
      utils.chat.listRules.invalidate();
      if (isNewRule) {
        setRuleModalName(null);
        setNewRuleName('');
        setRuleEditContent('');
      }
    },
  });
  useEffect(() => {
    if (ruleModalName === '__new__') setRuleEditContent('');
    else if (ruleModalName && ruleContent !== undefined)
      setRuleEditContent(ruleContent);
  }, [ruleModalName, ruleContent]);

  // Mutation to update session title
  const updateSessionTitle = trpc.sessions.updateTitle.useMutation({
    onSuccess: (_data, variables) => {
      utils.sessions.list.invalidate();
      utils.sessions.get.invalidate({ id: variables.id });
      setEditingSessionId(null);
      setEditingTitleInHeader(false);
    },
  });

  const deleteSession = trpc.sessions.delete.useMutation({
    onSuccess: () => {
      utils.sessions.list.invalidate();
      navigate('/chat'); // Navigate to a new session or home
    },
  });

  // Custom hook to fetch plan content
  const usePlanContent = (planName: string | null) => {
    return trpc.chat.getPlanContent.useQuery(
      { name: planName! },
      { enabled: !!planName }
    );
  };

  const planContentQuery = usePlanContent(planToAttach);

  // Effect: when dropped plan content is loaded, add to attachments
  useEffect(() => {
    if (planContentQuery.data && planToAttach) {
      setAttachments((prev) => {
        if (prev.some((a) => a.type === 'plan' && a.name === planToAttach))
          return prev;
        return [
          ...prev,
          { type: 'plan', name: planToAttach, content: planContentQuery.data },
        ];
      });
      setPlanToAttach(null);
    }
  }, [planContentQuery.data, planToAttach]);

  const createSession = trpc.sessions.create.useMutation({
    onSuccess: (s) => {
      refetchSessions();
      navigate(`/chat/${s.id}`);
    },
  });

  const addTodo = trpc.sessions.addTodo.useMutation({
    onSuccess: () => {
      if (sessionId) utils.sessions.get.invalidate({ id: sessionId });
    },
  });
  const updateTodo = trpc.sessions.updateTodo.useMutation({
    onSuccess: () => {
      if (sessionId) utils.sessions.get.invalidate({ id: sessionId });
    },
  });
  const removeTodo = trpc.sessions.removeTodo.useMutation({
    onSuccess: () => {
      if (sessionId) utils.sessions.get.invalidate({ id: sessionId });
    },
  });

  const buildMessageContent = useCallback(
    (text: string) => {
      if (attachments.length === 0) return text;
      let out = text;
      for (const a of attachments) {
        if (a.type === 'plan')
          out += `\n\n---\n### Plan: ${a.name}\n\n${a.content}\n---\n`;
      }
      return out;
    },
    [attachments]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (!text || !sessionId) return;

      sendAbortRef.current?.abort();
      const controller = new AbortController();
      sendAbortRef.current = controller;
      setPendingUserMessage(text);
      sendMessage.mutate({
        sessionId,
        content: buildMessageContent(text),
        modeId,
        providerId: providerId ?? 'openai',
        ...(providerId === 'runpod' && selectedRunpodModelId
          ? { model: selectedRunpodModelId }
          : {}),
      });
      setInput('');
      setAttachments([]);
    },
    [
      input,
      sessionId,
      modeId,
      providerId,
      selectedRunpodModelId,
      sendMessage,
      buildMessageContent,
    ]
  );

  const handleCancel = useCallback(() => {
    sendAbortRef.current?.abort();
    if (sessionId) abortRun.mutate({ sessionId });
    setRunCancelled(true);
    setRunPendingSince(null);
    setLiveProgressFromStream(null);
  }, [sessionId, abortRun]);

  const handleAddTodo = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const desc = todoInput.trim();
      if (!desc || !sessionId) return;
      addTodo.mutate({ sessionId, description: desc });
      setTodoInput('');
    },
    [todoInput, sessionId, addTodo]
  );

  const messages = session?.messages ?? [];
  const displayMessages = messages.filter((m) => m.role !== 'system');
  const displayMessagesWithPending = useMemo(() => {
    if (!pendingUserMessage) return displayMessages;
    return [
      ...displayMessages,
      { role: 'user', content: pendingUserMessage } as ChatMsg,
    ];
  }, [displayMessages, pendingUserMessage]);
  const todos = session?.todos ?? [];
  const workLogEntriesFromMessages = useMemo(
    () => buildWorkLogEntries(messages),
    [messages]
  );
  const runProgressEntries =
    liveProgressFromStream?.entries ?? runProgress?.entries ?? [];
  const workLogEntries = useMemo(() => {
    if (runProgressEntries.length === 0) return workLogEntriesFromMessages;
    return [
      ...workLogEntriesFromMessages,
      ...runProgressEntries.map((e) => ({
        type: e.type as 'status' | 'tool',
        description: e.description,
        toolName: e.toolName,
        resultSummary: e.resultSummary,
        pending: e.pending,
      })),
    ];
  }, [workLogEntriesFromMessages, runProgressEntries]);
  const isRunInProgress =
    !runCancelled &&
    (waitingForRunStart ||
      (liveProgressFromStream ? liveProgressFromStream.running : false) ||
      sendMessage.isPending ||
      runProgress?.running === true);
  const statusText = isRunInProgress ? 'Sending…' : 'Ready';

  useEffect(() => {
    const el = chatMessagesRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [sessionId, displayMessagesWithPending.length, runProgressEntries.length]);

  useEffect(() => {
    const el = workLogRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollTop = 0;
    });
    return () => cancelAnimationFrame(id);
  }, [workLogEntries.length]);

  // Keep tool status box scrolled to bottom so "Thinking…" is always visible
  useEffect(() => {
    const el = statusBoxRef.current;
    if (!el || !isRunInProgress) return;
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [isRunInProgress, runProgressEntries.length]);

  const contextTokens = useMemo(() => {
    let total = SYSTEM_PROMPT_ESTIMATE_TOKENS;
    for (const m of messages) total += estimateMessageTokens(m);
    return total;
  }, [messages]);
  const contextWithDraft =
    contextTokens + Math.ceil(input.length / CHARS_PER_TOKEN_ESTIMATE);
  const contextPct = Math.min(
    100,
    (contextWithDraft / MAX_CONTEXT_TOKENS) * 100
  );

  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== 'Enter') return;
      if (e.shiftKey) return;
      e.preventDefault();
      const text = input.trim();
      if (!text || !sessionId) return;
      sendAbortRef.current?.abort();
      const controller = new AbortController();
      sendAbortRef.current = controller;
      setPendingUserMessage(text);
      sendMessage.mutate({
        sessionId,
        content: buildMessageContent(text),
        modeId,
        providerId: providerId ?? 'openai',
        ...(providerId === 'runpod' && selectedRunpodModelId
          ? { model: selectedRunpodModelId }
          : {}),
      });
      setInput('');
      setAttachments([]);
    },
    [
      input,
      sessionId,
      modeId,
      providerId,
      selectedRunpodModelId,
      sendMessage,
      buildMessageContent,
    ]
  );

  useEffect(() => {
    if (
      !contextModalOpen &&
      !planModalName &&
      !ruleModalName &&
      !transcriptModalOpen
    )
      return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextModalOpen(false);
        setPlanModalName(null);
        setRuleModalName(null);
        setTranscriptModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [contextModalOpen, planModalName, ruleModalName, transcriptModalOpen]);

  useEffect(() => {
    // Handle Shift+Tab to cycle through modes
    const handleModeSwitch = (e: KeyboardEvent) => {
      if (
        e.shiftKey &&
        e.key === 'Tab' &&
        !contextModalOpen &&
        !planModalName &&
        !ruleModalName &&
        !transcriptModalOpen
      ) {
        e.preventDefault();
        if (!modes || modes.length === 0) return;
        const currentIndex = modes.findIndex((m) => m.id === modeId);
        const nextIndex = (currentIndex - 1 + modes.length) % modes.length;
        setModeId(modes[nextIndex].id);
      }
    };
    window.addEventListener('keydown', handleModeSwitch);
    return () => window.removeEventListener('keydown', handleModeSwitch);
  }, [
    modeId,
    modes,
    contextModalOpen,
    planModalName,
    ruleModalName,
    transcriptModalOpen,
  ]);

  return (
    <div className="chat-layout">
      <aside className="chat-sidebar">
        <Accordion defaultValue="sessions" multiple>
          <Accordion.Item value="sessions">
            <Accordion.Control>Sessions</Accordion.Control>
            <Accordion.Panel>
              <div className="chat-sidebar__header" style={{ flexShrink: 0 }}>
                <Button
                  type="button"
                  variant="subtle"
                  size="xs"
                  fullWidth
                  onClick={() => createSession.mutate({})}
                  loading={createSession.isPending}
                >
                  New chat
                </Button>
              </div>
              <ScrollArea h={400} type="always">
                <ul
                  className="chat-sidebar__list"
                  style={{
                    padding: 0,
                    margin: 0,
                    listStyle: 'none',
                    width: '100%',
                    maxHeight: 'calc(100% - 32px)',
                    overflowY: 'auto',
                  }}
                >
                  {sessions?.map((s) => (
                    <li
                      key={s.id}
                      style={{
                        padding: '2px 8px',
                        margin: '1px 0',
                        minHeight: '24px',
                        backgroundColor:
                          sessionId === s.id
                            ? 'var(--app-hover)'
                            : 'transparent',
                      }}
                    >
                      {editingSessionId === s.id ? (
                        <form
                          className="chat-session-edit"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (newSessionTitle.trim()) {
                              updateSessionTitle.mutate({
                                id: s.id,
                                title: newSessionTitle.trim(),
                              });
                            } else {
                              setEditingSessionId(null);
                            }
                          }}
                        >
                          <TextInput
                            value={newSessionTitle}
                            onChange={(e) =>
                              setNewSessionTitle(e.currentTarget.value)
                            }
                            onBlur={() => {
                              if (newSessionTitle.trim()) {
                                updateSessionTitle.mutate({
                                  id: s.id,
                                  title: newSessionTitle.trim(),
                                });
                              } else {
                                setEditingSessionId(null);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                setEditingSessionId(null);
                              }
                            }}
                            autoFocus
                            size="xs"
                            styles={{
                              input: { fontSize: '0.85em', minHeight: 28 },
                            }}
                          />
                        </form>
                      ) : (
                        <div
                          className="chat-session-item"
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontSize: '0.8em',
                            height: '24px',
                            backgroundColor:
                              sessionId === s.id
                                ? 'var(--app-hover)'
                                : 'transparent',
                            cursor: 'pointer',
                          }}
                        >
                          <Link
                            to={`/chat/${s.id}`}
                            className={sessionId === s.id ? 'active' : ''}
                            onDoubleClick={() => {
                              setEditingSessionId(s.id);
                              setNewSessionTitle(s.title || 'Chat');
                            }}
                            style={{
                              flex: 1,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              color: 'var(--app-text)',
                              textDecoration: 'none',
                              backgroundColor: 'transparent',
                            }}
                          >
                            {s.title || 'Chat'}
                          </Link>
                          <ActionIcon
                            type="button"
                            variant="subtle"
                            size="sm"
                            color="gray"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (
                                window.confirm(
                                  `Are you sure you want to delete \"${s.title || 'Chat'}\"? This cannot be undone.`
                                )
                              ) {
                                deleteSession.mutate({ id: s.id });
                              }
                            }}
                            title="Delete session"
                            aria-label="Delete session"
                          >
                            ×
                          </ActionIcon>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </Accordion.Panel>
          </Accordion.Item>

          <Accordion.Item value="plans">
            <Accordion.Control>Plans</Accordion.Control>
            <Accordion.Panel
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                minHeight: 0,
                maxHeight: '25%',
              }}
            >
              <ScrollArea style={{ flex: 1, minHeight: 0 }} type="always">
                <ul
                  className="chat-sidebar__list"
                  style={{
                    padding: 0,
                    margin: 0,
                    listStyle: 'none',
                    width: '100%',
                    maxHeight: 'calc(100% - 32px)',
                    overflowY: 'auto',
                  }}
                >
                  {plans && plans.length > 0 ? (
                    plans.map((p) => (
                      <li
                        key={p.name}
                        style={{
                          padding: '4px 12px',
                          margin: '2px 0',
                        }}
                      >
                        <Button
                          type="button"
                          variant="subtle"
                          size="xs"
                          fullWidth
                          style={{ justifyContent: 'flex-start' }}
                          onClick={() => setPlanModalName(p.name)}
                          draggable={true}
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', p.name);
                            e.dataTransfer.effectAllowed = 'copy';
                          }}
                        >
                          {p.name}
                        </Button>
                      </li>
                    ))
                  ) : (
                    <li
                      className="chat-sidebar__empty"
                      style={{
                        padding: '8px 12px',
                        margin: '2px 0',
                      }}
                    >
                      No plans yet
                    </li>
                  )}
                </ul>
              </ScrollArea>
            </Accordion.Panel>
          </Accordion.Item>

          <Accordion.Item value="rules">
            <Accordion.Control>Rules</Accordion.Control>
            <Accordion.Panel
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                minHeight: 0,
                maxHeight: '25%',
              }}
            >
              <ScrollArea style={{ flex: 1, minHeight: 0 }} type="always">
                <ul
                  className="chat-sidebar__list"
                  style={{
                    padding: 0,
                    margin: 0,
                    listStyle: 'none',
                    width: '100%',
                    maxHeight: 'calc(100% - 64px)',
                    overflowY: 'auto',
                  }}
                >
                  {rules && rules.length > 0 ? (
                    rules.map((r) => (
                      <li
                        key={r.name}
                        style={{
                          padding: '4px 12px',
                          margin: '2px 0',
                        }}
                      >
                        <Button
                          type="button"
                          variant="subtle"
                          size="xs"
                          fullWidth
                          style={{ justifyContent: 'flex-start' }}
                          onClick={() => setRuleModalName(r.name)}
                        >
                          {r.name}
                        </Button>
                      </li>
                    ))
                  ) : (
                    <li
                      className="chat-sidebar__empty"
                      style={{
                        padding: '8px 12px',
                        margin: '2px 0',
                      }}
                    >
                      No rules yet
                    </li>
                  )}
                  <li
                    style={{
                      padding: '4px 12px',
                      margin: '2px 0',
                      borderTop: '1px solid #eee',
                    }}
                  >
                    <form
                      className="chat-rules-add"
                      onSubmit={(e) => {
                        e.preventDefault();
                        setRuleModalName('__new__');
                      }}
                      style={{ margin: 0 }}
                    >
                      <Button
                        type="submit"
                        variant="subtle"
                        size="xs"
                        fullWidth
                      >
                        Add rule
                      </Button>
                    </form>
                  </li>
                </ul>
              </ScrollArea>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </aside>
      <main className="chat-main">
        {!sessionId ? (
          <div className="chat-welcome">
            <h1>Chat</h1>
            <p>Select a session or create a new one to start.</p>
          </div>
        ) : isLoading ? (
          <div className="loading">Loading…</div>
        ) : error ? (
          <div className="error">Error: {error.message}</div>
        ) : (
          <>
            <header className="chat-header">
              {editingTitleInHeader ? (
                <form
                  className="chat-header__title-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newSessionTitle.trim() && sessionId) {
                      updateSessionTitle.mutate({
                        id: sessionId,
                        title: newSessionTitle.trim(),
                      });
                    }
                    setEditingTitleInHeader(false);
                  }}
                >
                  <input
                    type="text"
                    className="chat-header__title-input"
                    value={newSessionTitle}
                    onChange={(e) => setNewSessionTitle(e.target.value)}
                    onBlur={() => {
                      if (newSessionTitle.trim() && sessionId) {
                        updateSessionTitle.mutate({
                          id: sessionId,
                          title: newSessionTitle.trim(),
                        });
                      }
                      setEditingTitleInHeader(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        setNewSessionTitle(session?.title ?? 'Chat');
                        setEditingTitleInHeader(false);
                      }
                    }}
                    autoFocus
                    aria-label="Session name"
                  />
                </form>
              ) : (
                <h1
                  className="chat-header__title"
                  onDoubleClick={() => {
                    if (sessionId) {
                      setEditingTitleInHeader(true);
                      setNewSessionTitle(session?.title ?? 'Chat');
                    }
                  }}
                  title="Double-click to rename"
                >
                  {session?.title ?? 'Chat'}
                </h1>
              )}
              <div className="chat-header__controls">
                {providerId === 'runpod' && defaultPodId && runpodIsRunning && (
                  <Select
                    size="xs"
                    value={selectedRunpodModelId ?? runpodModels[0]?.id ?? null}
                    onChange={(v) => {
                      if (v) {
                        setSelectedRunpodModelId(v);
                        localStorage.setItem(RUNPOD_CHAT_MODEL_KEY, v);
                      }
                    }}
                    data={runpodModels.map((m) => ({
                      value: m.id,
                      label: m.id,
                    }))}
                    placeholder={
                      runpodModels.length === 0 ? 'Loading…' : 'Model'
                    }
                    aria-label="RunPod model"
                    title="RunPod model"
                    allowDeselect={false}
                    style={{ minWidth: 160 }}
                  />
                )}
                {providers && providers.length > 0 && (
                  <Select
                    size="xs"
                    value={providerId ?? null}
                    onChange={(v) => {
                      const id = v ?? '';
                      setProviderId(id);
                      if (typeof window !== 'undefined' && id)
                        localStorage.setItem(CHAT_PROVIDER_KEY, id);
                    }}
                    data={providers.map((p) => ({
                      value: p.id,
                      label:
                        'configured' in p && !p.configured
                          ? `${p.name} (set API key)`
                          : p.name,
                    }))}
                    aria-label="LLM provider"
                    title="LLM provider"
                    allowDeselect={false}
                    style={{ minWidth: 140 }}
                  />
                )}
                {providerId === 'runpod' && (
                  <Group gap="xs" wrap="nowrap">
                    {!defaultPodId ? (
                      <Text size="xs" c="dimmed" component={Link} to="/runpod">
                        Set default pod on RunPod page
                      </Text>
                    ) : runpodConfigMissing ? (
                      <Text size="xs" c="dimmed" component={Link} to="/runpod">
                        Configure RunPod (API key) on RunPod page
                      </Text>
                    ) : (
                      <>
                        <Text size="xs" c="dimmed">
                          {getPodsMutation.isPending
                            ? '…'
                            : defaultPod
                              ? runpodIsRunning
                                ? 'Running'
                                : (defaultPod.status ?? 'Unknown')
                              : 'Default pod not found'}
                        </Text>
                        {runpodIsRunning &&
                          (runpodV1Fetching && runpodV1Connectivity == null ? (
                            <Text size="xs" c="dimmed">
                              Checking…
                            </Text>
                          ) : runpodV1Connectivity?.reachable === true ? (
                            <Text size="xs" c="green">
                              · Connected
                            </Text>
                          ) : runpodV1Connectivity?.reachable === false ? (
                            <Text size="xs" c="red">
                              · Unreachable
                            </Text>
                          ) : null)}
                        {runpodCanStart && (
                          <Tooltip label="Start default pod">
                            <ActionIcon
                              size="sm"
                              color="green"
                              variant="light"
                              onClick={() => {
                                const raw =
                                  localStorage.getItem(RUNPOD_CONFIG_KEY);
                                if (!raw) return;
                                const config = JSON.parse(raw) as {
                                  apiKey: string;
                                  endpoint?: string;
                                };
                                if (config?.apiKey && defaultPodId)
                                  startPodMutation.mutate(
                                    {
                                      apiKey: config.apiKey,
                                      endpoint: config.endpoint,
                                      podId: defaultPodId,
                                    },
                                    {
                                      onSuccess: () => {
                                        getPodsMutation.mutate(
                                          {
                                            apiKey: config.apiKey,
                                            endpoint: config.endpoint,
                                          },
                                          {
                                            onSuccess: (r) =>
                                              r.success &&
                                              r.pods &&
                                              setRunpodPods(r.pods),
                                          }
                                        );
                                      },
                                    }
                                  );
                              }}
                              loading={startPodMutation.isPending}
                            >
                              <IconPlayerPlay size={14} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                        {runpodCanStop && (
                          <Tooltip label="Stop default pod">
                            <ActionIcon
                              size="sm"
                              color="yellow"
                              variant="light"
                              onClick={() => {
                                const raw =
                                  localStorage.getItem(RUNPOD_CONFIG_KEY);
                                if (!raw) return;
                                const config = JSON.parse(raw) as {
                                  apiKey: string;
                                  endpoint?: string;
                                };
                                if (config?.apiKey && defaultPodId)
                                  stopPodMutation.mutate(
                                    {
                                      apiKey: config.apiKey,
                                      endpoint: config.endpoint,
                                      podId: defaultPodId,
                                    },
                                    {
                                      onSuccess: () => {
                                        getPodsMutation.mutate(
                                          {
                                            apiKey: config.apiKey,
                                            endpoint: config.endpoint,
                                          },
                                          {
                                            onSuccess: (r) =>
                                              r.success &&
                                              r.pods &&
                                              setRunpodPods(r.pods),
                                          }
                                        );
                                      },
                                    }
                                  );
                              }}
                              loading={stopPodMutation.isPending}
                            >
                              <IconPlayerStop size={14} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </>
                    )}
                  </Group>
                )}
                <Button
                  variant="subtle"
                  size="xs"
                  onClick={() => setTranscriptModalOpen(true)}
                  title="View full message transcript"
                >
                  View transcript
                </Button>
                <Button
                  variant="subtle"
                  size="xs"
                  onClick={() => setContextModalOpen(true)}
                  title="View context sent to the model"
                >
                  Context
                </Button>
                <Button
                  variant="subtle"
                  size="xs"
                  color="red"
                  onClick={() => {
                    if (
                      window.confirm(
                        'Are you sure you want to clear this chat? This cannot be undone.'
                      )
                    ) {
                      deleteSession.mutate({ id: sessionId! });
                      navigate('/chat');
                    }
                  }}
                  title="Clear chat"
                >
                  Clear chat
                </Button>
              </div>
            </header>
            <div className="chat-status-bar">
              <span>
                <span className="chat-status-bar__label">Status:</span>
                <span className="chat-status-bar__value">{statusText}</span>
              </span>
              {(() => {
                const current =
                  providerId && providers.length
                    ? providers.find((p) => p.id === providerId)
                    : null;
                const providerUrl =
                  current &&
                  'url' in current &&
                  typeof (current as { url?: string }).url === 'string'
                    ? (current as { url: string }).url
                    : null;
                return providerUrl ? (
                  <Tooltip label="Click to copy">
                    <Text
                      size="xs"
                      c="dimmed"
                      style={{
                        fontFamily: 'monospace',
                        fontSize: '0.7rem',
                        cursor: 'pointer',
                      }}
                      onClick={() => navigator.clipboard.writeText(providerUrl)}
                    >
                      {providerUrl}
                    </Text>
                  </Tooltip>
                ) : null;
              })()}
            </div>
            <div
              className={`chat-context-bar ${contextPct >= 80 ? 'chat-context-bar--high' : ''}`}
            >
              <span className="chat-context-bar__label">Context</span>
              <div className="chat-context-bar__track">
                <div
                  className="chat-context-bar__fill"
                  style={{ width: `${contextPct}%` }}
                  title={`~${(contextWithDraft / 1000).toFixed(1)}k / ${(MAX_CONTEXT_TOKENS / 1000).toFixed(0)}k tokens`}
                />
              </div>
              <span className="chat-context-bar__value">
                ~{(contextWithDraft / 1000).toFixed(1)}k /{' '}
                {(MAX_CONTEXT_TOKENS / 1000).toFixed(0)}k
              </span>
            </div>
            <div
              className="chat-body"
              onDrop={(e) => {
                e.preventDefault();
                const planName = e.dataTransfer.getData('text/plain');
                if (planName) {
                  e.stopPropagation();
                  // Set the plan to attach
                  setPlanToAttach(planName);
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              }}
            >
              <div className="chat-messages-wrap">
                <div className="chat-messages" ref={chatMessagesRef}>
                  {displayMessagesWithPending.map((msg, i) => (
                    <ChatMessage key={i} message={msg} compact />
                  ))}
                  {isRunInProgress && (
                    <div
                      className="chat-status-box"
                      ref={statusBoxRef}
                      role="status"
                      aria-live="polite"
                    >
                      {runProgressEntries.length > 0 && (
                        <div className="chat-tool-status-list">
                          {runProgressEntries.map((entry, i) => (
                            <div
                              key={i}
                              className={`chat-tool-status ${entry.pending ? 'chat-tool-status--pending' : ''}`}
                            >
                              <span
                                className="chat-tool-status__indicator"
                                aria-hidden
                              >
                                {entry.pending ? '○' : '●'}
                              </span>
                              <span className="chat-tool-status__text">
                                {entry.type === 'status'
                                  ? entry.description
                                  : (entry.description ?? entry.toolName)}
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
                {sendMessage.error && (
                  <div className="chat-error">{sendMessage.error.message}</div>
                )}
                {modes && modes.length > 0 && (
                  <div className="chat-mode-indicator">
                    <span className="chat-mode-label">Mode:</span>
                    <span
                      className="chat-mode-name"
                      title="Press Shift+Tab to switch modes"
                    >
                      {modes.find((m) => m.id === modeId)?.name || 'Unknown'}
                    </span>
                  </div>
                )}
                <form className="chat-form" onSubmit={handleSubmit}>
                  <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleTextareaKeyDown}
                    placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
                    minRows={2}
                    maxRows={6}
                    autosize
                    disabled={isRunInProgress}
                    styles={{
                      root: { flex: 1, minHeight: 60 },
                      input: { fontFamily: 'inherit' },
                    }}
                  />
                  <div className="chat-form__actions">
                    <Button
                      type="submit"
                      disabled={isRunInProgress || !input.trim()}
                      loading={sendMessage.isPending}
                    >
                      {sendMessage.isPending ? 'Sending…' : 'Send'}
                    </Button>
                    {isRunInProgress && (
                      <Button
                        type="button"
                        variant="default"
                        onClick={handleCancel}
                        aria-label="Cancel"
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </form>
              </div>
              <aside className="chat-right-panel">
                <Accordion defaultValue="todos" multiple>
                  <Accordion.Item value="todos">
                    <Accordion.Control>
                      <h3 className="chat-panel-section__title">Todos</h3>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <ul className="chat-todos">
                        {todos.map((t) => (
                          <li key={t.id} className="chat-todos__item">
                            <span
                              className={`chat-todos__box chat-todos__box--${t.status}`}
                            >
                              {t.status === 'completed' ? '✓' : ' '}
                            </span>
                            <span className="chat-todos__desc">
                              {t.description}
                            </span>
                            <div
                              className="chat-todos__actions"
                              style={{ display: 'flex', gap: 4 }}
                            >
                              {t.status !== 'completed' && (
                                <Button
                                  type="button"
                                  variant="subtle"
                                  size="compact-xs"
                                  onClick={() =>
                                    updateTodo.mutate({
                                      sessionId: sessionId!,
                                      todoId: t.id,
                                      status: 'completed',
                                    })
                                  }
                                  disabled={updateTodo.isPending}
                                  title="Mark completed"
                                >
                                  Done
                                </Button>
                              )}
                              <Button
                                type="button"
                                variant="subtle"
                                size="compact-xs"
                                color="red"
                                onClick={() =>
                                  removeTodo.mutate({
                                    sessionId: sessionId!,
                                    todoId: t.id,
                                  })
                                }
                                disabled={removeTodo.isPending}
                                title="Remove"
                              >
                                ×
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                      <form
                        className="chat-todos-add"
                        onSubmit={handleAddTodo}
                        style={{
                          display: 'flex',
                          gap: 8,
                          alignItems: 'stretch',
                        }}
                      >
                        <TextInput
                          placeholder="Add a todo…"
                          value={todoInput}
                          onChange={(e) => setTodoInput(e.currentTarget.value)}
                          disabled={addTodo.isPending}
                          size="xs"
                          style={{ flex: 1 }}
                        />
                        <Button
                          type="submit"
                          size="xs"
                          disabled={addTodo.isPending || !todoInput.trim()}
                        >
                          Add
                        </Button>
                      </form>
                    </Accordion.Panel>
                  </Accordion.Item>

                  <Accordion.Item value="attachments">
                    <Accordion.Control>
                      <h3 className="chat-panel-section__title">Attachments</h3>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <div className="chat-attachments">
                        {attachments.length === 0 ? (
                          <p className="chat-panel-empty">
                            No attachments. Drop a plan from the sidebar.
                          </p>
                        ) : (
                          <ul className="chat-attachments__list">
                            {attachments.map((a, i) =>
                              a.type === 'plan' ? (
                                <li
                                  key={`plan-${a.name}-${i}`}
                                  className="chat-attachments__item"
                                >
                                  <span className="chat-attachments__label">
                                    Plan: {a.name}
                                  </span>
                                  <Button
                                    type="button"
                                    variant="subtle"
                                    size="compact-xs"
                                    color="red"
                                    onClick={() =>
                                      setAttachments((prev) =>
                                        prev.filter((_, idx) => idx !== i)
                                      )
                                    }
                                    title="Remove attachment"
                                    aria-label={`Remove ${a.name}`}
                                  >
                                    ×
                                  </Button>
                                </li>
                              ) : null
                            )}
                          </ul>
                        )}
                      </div>
                    </Accordion.Panel>
                  </Accordion.Item>

                  <Accordion.Item value="work-log">
                    <Accordion.Control>
                      <h3 className="chat-panel-section__title">Work log</h3>
                    </Accordion.Control>
                    <Accordion.Panel
                      style={{
                        maxHeight: '200px',
                        overflowY: 'auto',
                        padding: '8px 0',
                      }}
                    >
                      <div className="chat-work-log" ref={workLogRef}>
                        {workLogEntries.length === 0 ? (
                          <p className="chat-panel-empty">No activity yet.</p>
                        ) : (
                          [...workLogEntries]
                            .slice(-50)
                            .reverse()
                            .map((entry, i) => (
                              <div
                                key={i}
                                className={`chat-work-log__entry chat-work-log__entry--${entry.type}${entry.pending ? ' chat-work-log__entry--pending' : ''}`}
                              >
                                {entry.type === 'status' ? (
                                  <span className="chat-work-log__status-desc">
                                    {entry.description}
                                  </span>
                                ) : (
                                  <>
                                    <span className="chat-work-log__tool-name">
                                      {entry.toolName}
                                      {entry.pending && (
                                        <span className="chat-work-log__pending">
                                          {' '}
                                          …
                                        </span>
                                      )}
                                    </span>
                                    {entry.resultSummary && (
                                      <pre className="chat-work-log__result">
                                        {entry.resultSummary}
                                      </pre>
                                    )}
                                  </>
                                )}
                              </div>
                            ))
                        )}
                      </div>
                    </Accordion.Panel>
                  </Accordion.Item>
                </Accordion>
              </aside>
            </div>
            {contextModalOpen && (
              <div
                className="context-modal-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="context-modal-title"
                onClick={(e) =>
                  e.target === e.currentTarget && setContextModalOpen(false)
                }
              >
                <div className="context-modal">
                  <div className="context-modal__header">
                    <h2 id="context-modal-title">Context</h2>
                    <ActionIcon
                      type="button"
                      variant="subtle"
                      size="sm"
                      onClick={() => setContextModalOpen(false)}
                      aria-label="Close"
                    >
                      ×
                    </ActionIcon>
                  </div>
                  <div className="context-modal__body">
                    {contextLoading ? (
                      <p className="context-modal__loading">Loading…</p>
                    ) : contextData ? (
                      <>
                        <section className="context-modal__section">
                          <h3 className="context-modal__section-title">
                            System prompt ({contextData.modeName})
                          </h3>
                          <pre className="context-modal__block">
                            {contextData.systemPrompt}
                          </pre>
                        </section>
                        <section className="context-modal__section">
                          <h3 className="context-modal__section-title">
                            Messages ({contextData.messages.length})
                          </h3>
                          {contextData.messages.length === 0 ? (
                            <p className="context-modal__empty">
                              No messages yet.
                            </p>
                          ) : (
                            <div className="context-modal__messages">
                              {contextData.messages.map((msg, i) => (
                                <div
                                  key={i}
                                  className={`context-modal__msg context-modal__msg--${msg.role}`}
                                >
                                  <span className="context-modal__msg-role">
                                    {msg.role}
                                  </span>
                                  {'toolCalls' in msg &&
                                  Array.isArray(msg.toolCalls) &&
                                  (msg.toolCalls as unknown[]).length > 0 ? (
                                    <pre className="context-modal__block">
                                      {msg.content || '(no text)'}
                                      {'\n\nTool calls: ' +
                                        (
                                          msg.toolCalls as Array<{
                                            function: {
                                              name: string;
                                              arguments: string;
                                            };
                                          }>
                                        )
                                          .map(
                                            (tc) =>
                                              `${tc.function.name}(${tc.function.arguments})`
                                          )
                                          .join('\n')}
                                    </pre>
                                  ) : (
                                    <pre className="context-modal__block">
                                      {msg.content || '(empty)'}
                                    </pre>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </section>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
            {transcriptModalOpen && (
              <div
                className="context-modal-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="transcript-modal-title"
                onClick={(e) =>
                  e.target === e.currentTarget && setTranscriptModalOpen(false)
                }
              >
                <div className="context-modal transcript-modal">
                  <div className="context-modal__header">
                    <h2 id="transcript-modal-title">Transcript</h2>
                    <ActionIcon
                      type="button"
                      variant="subtle"
                      size="sm"
                      onClick={() => setTranscriptModalOpen(false)}
                      aria-label="Close"
                    >
                      ×
                    </ActionIcon>
                  </div>
                  <div className="context-modal__body transcript-modal__body">
                    {displayMessagesWithPending.length === 0 ? (
                      <p className="context-modal__empty">No messages yet.</p>
                    ) : (
                      <div className="transcript-modal__messages">
                        {displayMessagesWithPending.map((msg, i) => (
                          <ChatMessage key={i} message={msg} compact={false} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            {planModalName && (
              <div
                className="context-modal-overlay plan-modal-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="plan-modal-title"
                onClick={(e) =>
                  e.target === e.currentTarget && setPlanModalName(null)
                }
              >
                <div className="context-modal plan-modal">
                  <div className="context-modal__header">
                    <h2 id="plan-modal-title">{planModalName}</h2>
                    <ActionIcon
                      type="button"
                      variant="subtle"
                      size="sm"
                      onClick={() => setPlanModalName(null)}
                      aria-label="Close"
                    >
                      ×
                    </ActionIcon>
                  </div>
                  <div className="context-modal__body plan-modal__body">
                    {planContentLoading ? (
                      <p className="context-modal__loading">Loading…</p>
                    ) : planContent ? (
                      <div className="plan-modal__content">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {planContent}
                        </ReactMarkdown>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
            {ruleModalName && (
              <div
                className="context-modal-overlay plan-modal-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="rule-modal-title"
                onClick={(e) =>
                  e.target === e.currentTarget && setRuleModalName(null)
                }
              >
                <div className="context-modal plan-modal rule-modal">
                  <div className="context-modal__header">
                    <h2 id="rule-modal-title">
                      {isNewRule ? 'Add rule' : ruleModalName}
                    </h2>
                    <ActionIcon
                      type="button"
                      variant="subtle"
                      size="sm"
                      onClick={() => {
                        setRuleModalName(null);
                        setNewRuleName('');
                      }}
                      aria-label="Close"
                    >
                      ×
                    </ActionIcon>
                  </div>
                  <div className="context-modal__body plan-modal__body rule-modal__body">
                    {isNewRule && (
                      <div className="rule-modal__name-row">
                        <label htmlFor="rule-name">File name</label>
                        <TextInput
                          id="rule-name"
                          placeholder="e.g. coding-standards.md"
                          value={newRuleName}
                          onChange={(e) =>
                            setNewRuleName(e.currentTarget.value)
                          }
                          size="sm"
                        />
                      </div>
                    )}
                    {!isNewRule && ruleContentLoading ? (
                      <p className="context-modal__loading">Loading…</p>
                    ) : (
                      <Textarea
                        value={ruleEditContent}
                        onChange={(e) =>
                          setRuleEditContent(e.currentTarget.value)
                        }
                        placeholder="Rule content (markdown or plain text). Included in the system prompt for every request."
                        minRows={14}
                        autosize
                        styles={{ input: { fontFamily: 'inherit' } }}
                      />
                    )}
                    {(!isNewRule || newRuleName.trim()) && (
                      <div className="rule-modal__actions">
                        <Button
                          type="button"
                          loading={saveRule.isPending}
                          disabled={
                            saveRule.isPending ||
                            (isNewRule &&
                              (!/^[a-zA-Z0-9_.-]+$/.test(newRuleName.trim()) ||
                                newRuleName.trim().length > 120 ||
                                newRuleName.trim().includes('..')))
                          }
                          onClick={() => {
                            const name = isNewRule
                              ? newRuleName.trim()
                              : ruleModalName;
                            if (!name) return;
                            saveRule.mutate({ name, content: ruleEditContent });
                          }}
                        >
                          {saveRule.isPending ? 'Saving…' : 'Save'}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
