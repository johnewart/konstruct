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
const CHAT_MODEL_KEY = 'chat-model-id';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { trpc } from '../../client/trpc';
import { markdownCodeComponents } from '../components/MarkdownCodeComponents';
import { useProjectModel } from '../contexts/ProjectModelContext';
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
  Menu,
} from '@mantine/core';
import { IconPlayerPlay, IconPlayerStop, IconPlus } from '@tabler/icons-react';

// Git changes list component
function GitChangesList() {
  // Use a ref to track if the component is mounted/visible
  // This helps reduce unnecessary queries when the accordion is closed
  const [queryKey, setQueryKey] = useState(0);
  
  const { data: isGitAvailable } = trpc.git.isAvailable.useQuery();
  const { data: gitChanges, isLoading: gitLoading, isError } =
    trpc.git.getChangedFiles.useQuery(undefined, {
      refetchInterval: 1000, // Auto-refresh every second
      enabled: isGitAvailable !== false && queryKey > 0, // Only run if git available and component active
    });
  
  // Only start refetching when component mounts
  useEffect(() => {
    setQueryKey(1);
    return () => setQueryKey(0);
  }, []);

  if (isError) {
    // Don't show error in UI - just return empty to avoid cluttering
    return <p className="chat-panel-empty">No changes detected.</p>;
  }

  if (gitLoading || !isGitAvailable) {
    return <p className="chat-panel-empty">Checking git status…</p>;
  }

  if (!gitChanges || gitChanges.length === 0) {
    return <p className="chat-panel-empty">No changes yet.</p>;
  }

  return (
    <div className="chat-git-changes">
      <ul className="chat-git-changes__list">
        {gitChanges.map((change, i) => (
          <li key={i} className="chat-git-changes__item">
            <span className="chat-git-changes__path">{change.path}</span>
            <span
              className={`chat-git-changes__status git-status--${change.status}`}
              title={getStatusTitle(change.status)}
            >
              {getStatusIcon(change.status)}
            </span>
            <span className="chat-git-changes__stats">
              +{change.added} -{change.removed}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function getStatusTitle(status: string): string {
  switch (status) {
    case 'M':
      return 'Modified';
    case 'A':
      return 'Added';
    case 'D':
      return 'Deleted';
    case 'R':
      return 'Renamed';
    case 'C':
      return 'Copied';
    case '??':
      return 'Untracked';
    default:
      return 'Unknown';
  }
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'M':
      return 'M';
    case 'A':
      return 'A';
    case 'D':
      return 'D';
    case 'R':
      return 'R';
    case 'C':
      return 'C';
    case '??':
      return '?';
    default:
      return '?';
  }
}

const DEFAULT_MAX_CONTEXT_TOKENS = 200_000;
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

// Limit work log entries to prevent performance issues with long conversations
const MAX_WORK_LOG_MESSAGES = 200;

function buildWorkLogEntries(messages: ChatMsg[]): Array<{
  type: 'status' | 'tool';
  description?: string;
  toolName?: string;
  resultSummary?: string;
  pending?: boolean;
}> {
  // Limit messages processed for work log to prevent performance issues
  const messagesToProcess = messages.slice(-MAX_WORK_LOG_MESSAGES);
  
  const entries: Array<{
    type: 'status' | 'tool';
    description?: string;
    toolName?: string;
    resultSummary?: string;
    pending?: boolean;
  }> = [];
  for (let i = 0; i < messagesToProcess.length; i++) {
    const msg = messagesToProcess[i];
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
      for (let j = i + 1; j < messagesToProcess.length; j++) {
        const m = messagesToProcess[j] as ChatMsg;
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

// Attachment types (plan from sidebar, or user-added text)
type PlanAttachment =
  | { type: 'plan'; name: string; content: string }
  | { type: 'text'; name: string; content: string };

// Message queue type
type QueuedMessage = {
  id: string;
  content: string;
  attachments: PlanAttachment[];
  timestamp: number;
};

export function Chat() {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const navigate = useNavigate();
  const { isProjectScope: projectModelScope, providerId: projectProviderId, modelId: projectModelId } = useProjectModel();
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
  const [planFilterText, setPlanFilterText] = useState('');
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
  // Message queue state
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);

  const [attachmentsBySession, setAttachmentsBySession] = useState<
    Record<string, PlanAttachment[]>
  >({});
  const [addAttachmentModalOpen, setAddAttachmentModalOpen] = useState(false);
  const [newAttachmentName, setNewAttachmentName] = useState('');
  const [newAttachmentContent, setNewAttachmentContent] = useState('');
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
  const chatMessagesRef = useRef<HTMLDivElement | null>(null);
  const workLogRef = useRef<HTMLDivElement | null>(null);
  const todoListRef = useRef<HTMLUListElement | null>(null);
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
  const defaultProviderId = providersData?.defaultProviderId ?? '';
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
  const [selectedModelId, setSelectedModelId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(CHAT_MODEL_KEY);
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
  const configuredProviders = useMemo(
    () => providers.filter((p) => (p as { configured?: boolean }).configured === true),
    [providers]
  );
  useEffect(() => {
    const currentConfigured =
      providerId != null && providerId !== '' && configuredProviders.some((p) => p.id === providerId);
    if (currentConfigured) return;
    const next =
      defaultProviderId && configuredProviders.some((p) => p.id === defaultProviderId)
        ? defaultProviderId
        : configuredProviders[0]?.id ?? providers[0]?.id ?? '';
    setProviderId(next || null);
    if (typeof window !== 'undefined')
      localStorage.setItem(CHAT_PROVIDER_KEY, next || '');
  }, [providers, configuredProviders, defaultProviderId, providerId]);
  const effectiveProviderId =
    projectModelScope && projectProviderId
      ? projectProviderId
      : (providerId ?? defaultProviderId);
  const effectiveModelId =
    projectModelScope && projectProviderId
      ? projectModelId
      : providerId === 'runpod'
        ? selectedRunpodModelId
        : selectedModelId;

  const allModelOptions = useMemo(() => {
    const list: { providerId: string; providerName: string; modelId: string; modelName: string }[] = [];
    for (const p of configuredProviders) {
      const prov = p as { defaultModel?: string; models?: { id: string; name: string }[] };
      const isRunpod = p.id === 'runpod';
      let models =
        isRunpod && runpodModels.length > 0
          ? runpodModels.map((m) => ({ id: m.id, name: m.name ?? m.id }))
          : prov.models?.length
            ? prov.models
            : prov.defaultModel
              ? [{ id: prov.defaultModel, name: prov.defaultModel }]
              : [];
      if (models.length === 0) {
        // Claude SDK uses its own model selection; use "default" so we don't pass provider id (e.g. UUID) as model
        const providerType = (p as { type?: string }).type ?? '';
        const isClaudeCliOrSdk = providerType === 'claude_sdk';
        const isCursor = providerType === 'cursor';
        models = (isClaudeCliOrSdk || isCursor) ? [{ id: 'default', name: 'Default' }] : [{ id: p.id, name: p.name }];
      }
      for (const m of models) {
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
  // Do not pass an abort signal to sendMessage. That way navigation, unmount, or
  // React Query cancellation won't drop the request and trigger "Claude Code process aborted by user".
  // The run is only aborted when the user explicitly clicks Cancel (abortRun.mutate).
  const sendMessage = trpc.chat.sendMessage.useMutation({
    onSuccess: (data) => {
      setRunCancelled(false);
      setRunPendingSince(Date.now());
      setPendingUserMessage(null);
      if (sessionId) {
        // Update session cache immediately so UI shows new messages (handles fast runs where refetch effect may not fire)
        if (data) utils.sessions.get.setData({ id: sessionId }, data);
        utils.sessions.get.invalidate({ id: sessionId });
        void utils.sessions.get.refetch({ id: sessionId });
      }
      utils.chat.listPlans.invalidate();
      utils.chat.listRules.invalidate();
    },
    onSettled: () => {
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

  // When session is not found (e.g. belongs to another project after switch), go to chat home
  useEffect(() => {
    if (sessionId && error) {
      navigate('/', { replace: true });
    }
  }, [sessionId, error, navigate]);

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

  const isRunInProgress =
    !runCancelled &&
    (waitingForRunStart ||
      (liveProgressFromStream ? liveProgressFromStream.running : false) ||
      sendMessage.isPending ||
      runProgress?.running === true);
  const statusText = isRunInProgress ? 'Sending…' : 'Ready';

  const { data: contextData, isLoading: contextLoading } =
    trpc.chat.getContext.useQuery(
      { sessionId: sessionId!, modeId },
      { enabled: contextModalOpen && !!sessionId }
    );

  const { data: plans } = trpc.chat.listPlans.useQuery();
  
  // Filter plans based on search text
  const filteredPlans = useMemo(() => {
    if (!plans) return [];
    if (!planFilterText.trim()) return plans;
    
    const searchLower = planFilterText.toLowerCase();
    return plans.filter(p => 
      p.label.toLowerCase().includes(searchLower) ||
      p.name.toLowerCase().includes(searchLower)
    );
  }, [plans, planFilterText]);
  
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
  const deleteAllSessions = trpc.sessions.deleteAll.useMutation({
    onSuccess: (data) => {
      utils.sessions.list.invalidate();
      if (data.deleted > 0 && sessionId) navigate('/', { replace: true });
    },
  });

  const planContentQuery = trpc.chat.getPlanContent.useQuery(
    { name: planToAttach! },
    { enabled: !!planToAttach }
  );

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
  }, [planContentQuery.data, planToAttach, setAttachments]);

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
        const label = a.type === 'plan' ? `Plan: ${a.name}` : a.name;
        out += `\n\n\`\`\`${label}\n${a.content}\n\`\`\`\n`;
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

      // If agent is running, queue the message instead of sending immediately
      if (isRunInProgress) {
        const queuedMsg: QueuedMessage = {
          id: crypto.randomUUID(),
          content: buildMessageContent(text),
          attachments: [...attachments],
          timestamp: Date.now(),
        };
        setQueuedMessages((prev) => [...prev, queuedMsg]);
        setInput('');
        setAttachments([]);
        return;
      }

      setPendingUserMessage(text);
      sendMessage.mutate({
        sessionId,
        content: buildMessageContent(text),
        modeId,
        providerId: effectiveProviderId ?? defaultProviderId,
        ...(effectiveModelId ? { model: effectiveModelId } : {}),
      });
      setInput('');
      setAttachments([]);
    },
    [
      input,
      sessionId,
      modeId,
      effectiveProviderId,
      effectiveModelId,
      defaultProviderId,
      sendMessage,
      buildMessageContent,
      isRunInProgress,
      attachments,
    ]
  );

  const handleCancel = useCallback(() => {
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

  /* Hide tool messages and assistant "Used N tool(s)" placeholders in chat window (still in transcript) */
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

  // Keep todo list scrolled to bottom when new todos are added
  useEffect(() => {
    const el = todoListRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [todos.length]);

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

  const maxContextTokens = useMemo(() => {
    const p = providers.find((x) => x.id === (effectiveProviderId ?? defaultProviderId));
    const effectiveId = effectiveModelId ?? (p as { defaultModel?: string } | undefined)?.defaultModel;
    if (!effectiveId || !p?.models?.length) return DEFAULT_MAX_CONTEXT_TOKENS;
    const model = (p.models as { id: string; name: string; contextWindow?: number }[]).find(
      (m) => m.id === effectiveId || m.name === effectiveId
    );
    return model?.contextWindow && model.contextWindow > 0 ? model.contextWindow : DEFAULT_MAX_CONTEXT_TOKENS;
  }, [providers, effectiveProviderId, effectiveModelId, defaultProviderId]);

  const contextWithDraft =
    contextTokens + Math.ceil(input.length / CHARS_PER_TOKEN_ESTIMATE);
  const contextPct = Math.min(
    100,
    (contextWithDraft / maxContextTokens) * 100
  );

  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== 'Enter') return;
      if (e.shiftKey) return;
      e.preventDefault();
      const text = input.trim();
      if (!text || !sessionId) return;
      setPendingUserMessage(text);
      sendMessage.mutate({
        sessionId,
        content: buildMessageContent(text),
        modeId,
        providerId: effectiveProviderId ?? defaultProviderId,
        ...(effectiveModelId ? { model: effectiveModelId } : {}),
      });
      setInput('');
      setAttachments([]);
    },
    [
      input,
      sessionId,
      modeId,
      effectiveProviderId,
      effectiveModelId,
      defaultProviderId,
      sendMessage,
      buildMessageContent,
    ]
  );

  useEffect(() => {
    if (
      !contextModalOpen &&
      !planModalName &&
      !ruleModalName &&
      !transcriptModalOpen &&
      !addAttachmentModalOpen
    )
      return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextModalOpen(false);
        setPlanModalName(null);
        setRuleModalName(null);
        setTranscriptModalOpen(false);
        setAddAttachmentModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [contextModalOpen, planModalName, ruleModalName, transcriptModalOpen, addAttachmentModalOpen]);

  useEffect(() => {
    // Handle Shift+Tab to cycle through modes
    const handleModeSwitch = (e: KeyboardEvent) => {
      if (
        e.shiftKey &&
        e.key === 'Tab' &&
        !contextModalOpen &&
        !planModalName &&
        !ruleModalName &&
        !transcriptModalOpen &&
        !addAttachmentModalOpen
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
    addAttachmentModalOpen,
  ]);

  return (
    <div className="chat-layout">
      <aside className="chat-sidebar">
        <Accordion defaultValue={['sessions']} multiple>
          <Accordion.Item value="sessions">
            <Accordion.Control>
              <Group justify="space-between" wrap="nowrap" gap="xs">
                <span>Sessions</span>
                <Group gap={4} wrap="nowrap" onClick={(e) => e.stopPropagation()}>
                  <Button
                    type="button"
                    variant="subtle"
                    size="xs"
                    color="red"
                    onClick={() => {
                      if (window.confirm('Clear all chat sessions? This cannot be undone.')) {
                        deleteAllSessions.mutate();
                      }
                    }}
                    loading={deleteAllSessions.isPending}
                    title="Clear all sessions"
                  >
                    Clear all
                  </Button>
                  <Button
                    type="button"
                    variant="subtle"
                    size="xs"
                    onClick={() => createSession.mutate({})}
                    loading={createSession.isPending}
                  >
                    New
                  </Button>
                </Group>
              </Group>
            </Accordion.Control>
            <Accordion.Panel
              className="chat-sidebar__sessions-panel"
              style={{ padding: '2px 0' }}
            >
              <div className="chat-sidebar__sessions-inner">
                <ul className="chat-sidebar__list chat-sidebar__list--sessions">
                  {sessions?.map((s) => (
                    <li key={s.id} className="chat-sidebar__session-li">
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
                              input: { fontSize: '0.85em', minHeight: 24 },
                            }}
                          />
                        </form>
                      ) : (
                        <div
                          className={`chat-session-item ${sessionId === s.id ? 'active' : ''}`}
                        >
                          <Link
                            to={`/chat/${s.id}`}
                            onDoubleClick={() => {
                              setEditingSessionId(s.id);
                              setNewSessionTitle(s.title || 'Chat');
                            }}
                            className="chat-sidebar__session-link"
                          >
                            {s.title || 'Chat'}
                          </Link>
                          <ActionIcon
                            type="button"
                            variant="subtle"
                            size="xs"
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
              </div>
            </Accordion.Panel>
          </Accordion.Item>

          <Accordion.Item value="plans">
            <Accordion.Control>Plans</Accordion.Control>
            <Accordion.Panel
              className="chat-sidebar__plans-panel"
              style={{ padding: '8px 0' }}
            >
              {/* Filter input - always visible at top, outside scroll area */}
              <div className="chat-sidebar__filter-input">
                <TextInput
                  placeholder="Filter plans..."
                  value={planFilterText}
                  onChange={(e) => setPlanFilterText(e.target.value)}
                  size="xs"
                  variant="filled"
                />
              </div>
              
              <div className="chat-sidebar__plans-inner">
                <ul className="chat-sidebar__list chat-sidebar__list--plans">
                  {filteredPlans && filteredPlans.length > 0 ? (
                    filteredPlans.map((p) => (
                      <li key={p.name}>
                        <Button
                          type="button"
                          variant="subtle"
                          size="xs"
                          fullWidth
                          className="chat-sidebar__plan-btn"
                          style={{ justifyContent: 'flex-start' }}
                          onClick={() => setPlanModalName(p.name)}
                          draggable={true}
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', p.name);
                            e.dataTransfer.effectAllowed = 'copy';
                          }}
                        >
                          {p.label}
                        </Button>
                      </li>
                    ))
                  ) : filteredPlans && planFilterText && filteredPlans.length === 0 ? (
                    <li className="chat-sidebar__empty">No plans match your filter</li>
                  ) : (
                    <li className="chat-sidebar__empty">No plans yet</li>
                  )}
                </ul>
              </div>
            </Accordion.Panel>
          </Accordion.Item>

          <Accordion.Item value="rules">
            <Accordion.Control>
              <Group justify="space-between" wrap="nowrap" gap="xs">
                <span>Rules</span>
                <Button
                  type="button"
                  variant="subtle"
                  size="xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRuleModalName('__new__');
                  }}
                >
                  Add rule
                </Button>
              </Group>
            </Accordion.Control>
            <Accordion.Panel
              className="chat-sidebar__rules-panel"
              style={{ padding: '8px 0' }}
            >
              <div className="chat-sidebar__rules-inner">
                <ul className="chat-sidebar__list chat-sidebar__list--rules">
                  {rules && rules.length > 0 ? (
                    rules.map((r) => (
                      <li key={r.name}>
                        <Button
                          type="button"
                          variant="subtle"
                          size="xs"
                          fullWidth
                          className="chat-sidebar__rule-btn"
                          style={{ justifyContent: 'flex-start' }}
                          onClick={() => setRuleModalName(r.name)}
                        >
                          {r.name}
                        </Button>
                      </li>
                    ))
                  ) : (
                    <li className="chat-sidebar__empty">No rules yet</li>
                  )}
                </ul>
              </div>
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
                {/* Model/Provider and RunPod status moved to top navigation */}
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
                  effectiveProviderId && providers.length
                    ? providers.find((p) => p.id === effectiveProviderId)
                    : null;
                const providerUrl =
                  current &&
                  'url' in current &&
                  typeof (current as { url?: string }).url === 'string'
                    ? (current as { url: string }).url
                    : null;
                const isRunpod = effectiveProviderId === 'runpod';
                const podDot = isRunpod
                  ? (() => {
                      const accessible =
                        defaultPod &&
                        runpodIsRunning &&
                        runpodV1Connectivity?.reachable === true;
                      const starting =
                        defaultPod && runpodIsRunning && !accessible;
                      const off = !defaultPod || !runpodIsRunning;
                      const color = accessible
                        ? 'var(--mantine-color-green-6)'
                        : starting
                          ? 'var(--mantine-color-yellow-6)'
                          : 'var(--mantine-color-red-6)';
                      const label = accessible
                        ? 'Pod accessible'
                        : starting
                          ? 'Pod starting'
                          : 'Pod off';
                      return (
                        <Tooltip label={label}>
                          <span
                            style={{
                              display: 'inline-block',
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              backgroundColor: color,
                              marginRight: 6,
                              verticalAlign: 'middle',
                            }}
                            aria-hidden
                          />
                        </Tooltip>
                      );
                    })()
                  : null;
                return (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {podDot}
                    {providerUrl ? (
                      <Tooltip label="Click to copy">
                        <Text
                          size="xs"
                          c="dimmed"
                          style={{
                            fontFamily: "'IBM Plex Mono', monospace",
                            fontSize: '0.7rem',
                            cursor: 'pointer',
                          }}
                          onClick={() =>
                            navigator.clipboard.writeText(providerUrl)
                          }
                        >
                          {providerUrl}
                        </Text>
                      </Tooltip>
                    ) : null}
                  </span>
                );
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
                  title={`~${(contextWithDraft / 1000).toFixed(1)}k / ${(maxContextTokens / 1000).toFixed(0)}k tokens (${Math.round((contextWithDraft / maxContextTokens) * 100)}%)`}
                />
              </div>
              <span className="chat-context-bar__value">
                ~{(contextWithDraft / 1000).toFixed(1)}k /{' '}
                {(maxContextTokens / 1000).toFixed(0)}k (
                {Math.round((contextWithDraft / maxContextTokens) * 100)}%)
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
                  {/* Limit messages to prevent UI slowdown with long conversations */}
                  {chatWindowMessages.slice(-100).map((msg, i) => (
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
                              className={`chat-tool-status chat-tool-status--streaming ${entry.pending ? 'chat-tool-status--pending' : ''}`}
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
                                  : entry.description ?? (entry.toolName?.replace(/^mcp__konstruct__/, '') ?? 'tool')}
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
                    <span
                      className="chat-mode-indicator__model"
                      style={{ marginLeft: 'auto' }}
                    >
                      <span className="chat-mode-label">Model:</span>
                      {projectModelScope ? (
                        <Tooltip label="Change model in the top bar (project-wide)">
                          <span className="chat-mode-name">
                            {effectiveProviderId && allModelOptions.length > 0
                              ? (() => {
                                  const opt = allModelOptions.find(
                                    (o) => o.providerId === effectiveProviderId && o.modelId === effectiveModelId
                                  );
                                  return opt ? `${opt.providerName}: ${opt.modelName}` : (effectiveModelId ?? '—');
                                })()
                              : 'Set in top bar'}
                          </span>
                        </Tooltip>
                      ) : (
                        <Menu position="bottom-end" width={280} shadow="md">
                          <Menu.Target>
                            <Tooltip label="Click to change model">
                              <span
                                className="chat-mode-name"
                                style={{
                                  cursor: 'pointer',
                                  textDecoration: 'underline',
                                  textUnderlineOffset: 2,
                                }}
                              >
                                {providerId && providers.length
                                  ? (() => {
                                      const modelId =
                                        providerId === 'runpod'
                                          ? selectedRunpodModelId ?? (providers.find((p) => p.id === providerId) as { defaultModel?: string } | undefined)?.defaultModel
                                          : selectedModelId ?? (providers.find((p) => p.id === providerId) as { defaultModel?: string } | undefined)?.defaultModel;
                                      const opt = allModelOptions.find(
                                        (o) => o.providerId === providerId && o.modelId === modelId
                                      );
                                      return opt ? opt.modelName : (modelId ?? '—');
                                    })()
                                  : '—'}
                              </span>
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
                                    onClick={() => {
                                      setProviderId(opt.providerId);
                                      if (opt.providerId === 'runpod') {
                                        setSelectedRunpodModelId(opt.modelId);
                                        if (typeof window !== 'undefined')
                                          localStorage.setItem(RUNPOD_CHAT_MODEL_KEY, opt.modelId);
                                      } else {
                                        setSelectedModelId(opt.modelId);
                                        if (typeof window !== 'undefined')
                                          localStorage.setItem(CHAT_MODEL_KEY, opt.modelId);
                                      }
                                      if (typeof window !== 'undefined')
                                        localStorage.setItem(CHAT_PROVIDER_KEY, opt.providerId);
                                    }}
                                    style={{
                                      fontWeight: isSelected ? 600 : undefined,
                                    }}
                                  >
                                    {opt.providerName}: {opt.modelName}
                                  </Menu.Item>
                                );
                              })
                            )}
                          </Menu.Dropdown>
                        </Menu>
                      )}
                    </span>
                  </div>
                )}
                <div className="chat-form-wrap">
                <form className="chat-form" onSubmit={handleSubmit}>
                  <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleTextareaKeyDown}
                    placeholder={isRunInProgress ? "Type a message… (Queueing while agent is working)" : "Type a message… (Enter to send, Shift+Enter for new line)"}
                    minRows={2}
                    maxRows={6}
                    autosize
                    disabled={false}
                    styles={{
                      root: { flex: 1, minHeight: 60, opacity: isRunInProgress ? 0.8 : 1 },
                      input: { fontFamily: 'inherit' },
                    }}
                  />
                  <div className="chat-form__actions">
                    <Button
                      type="submit"
                      disabled={!input.trim()}
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
                {modes && modes.length > 0 && (
                  <div className="chat-form-mode-image">
                    <img
                      src={`/static/konstruct-${
                        ({ ask: 'ask', planning: 'planner', research: 'researcher', architecture: 'architect', implementation: 'builder', testing: 'tester' } as Record<string, string>)[
                          modeId
                        ] ?? 'builder'
                      }.png`}
                      alt=""
                      className="chat-form-mode-image__img"
                    />
                  </div>
                )}
                </div>
              </div>
              <aside className="chat-right-panel">
                <Accordion defaultValue={['todos']} multiple>
                  <Accordion.Item value="todos">
                    <Accordion.Control>
                      <h3 className="chat-panel-section__title">Todos</h3>
                    </Accordion.Control>
                    <Accordion.Panel className="chat-panel-todos">
                      {/* Add todo form - always visible at top */}
                      <form
                        className="chat-todos-add"
                        onSubmit={handleAddTodo}
                        style={{
                          display: 'flex',
                          gap: 8,
                          alignItems: 'stretch',
                          marginBottom: '8px',
                          flexShrink: 0,
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

                      {/* Scrollable todo list */}
                      <ul className="chat-todos" ref={todoListRef}>
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
                    </Accordion.Panel>
                  </Accordion.Item>

                  <Accordion.Item value="attachments">
                    <Accordion.Control>
                      <h3 className="chat-panel-section__title">Attachments</h3>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <div className="chat-attachments">
                        <Button
                          type="button"
                          variant="light"
                          size="xs"
                          leftSection={<IconPlus size={14} />}
                          onClick={() => {
                            setNewAttachmentName('');
                            setNewAttachmentContent('');
                            setAddAttachmentModalOpen(true);
                          }}
                          disabled={!sessionId}
                          fullWidth
                          mb="xs"
                        >
                          Add an attachment
                        </Button>
                        {attachments.length === 0 ? (
                          <p className="chat-panel-empty">
                            No attachments. Add one above or drop a plan from the sidebar.
                          </p>
                        ) : (
                          <ul className="chat-attachments__list">
                            {attachments.map((a, i) => (
                              <li
                                key={`${a.type}-${a.name}-${i}`}
                                className="chat-attachments__item"
                              >
                                <span className="chat-attachments__label">
                                  {a.type === 'plan' ? `Plan: ${a.name}` : a.name}
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
                            ))}
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
                                      {entry.toolName?.replace(/^mcp__konstruct__/, '') ?? 'tool'}
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

                  <Accordion.Item value="git-changes">
                    <Accordion.Control>
                      <h3 className="chat-panel-section__title">Git Changes</h3>
                    </Accordion.Control>
                    <Accordion.Panel
                      style={{
                        maxHeight: '200px',
                        overflowY: 'auto',
                        padding: '8px 0',
                      }}
                    >
                      <GitChangesList />
                    </Accordion.Panel>
                  </Accordion.Item>

                  <Accordion.Item value="queued-messages">
                    <Accordion.Control>
                      <h3 className="chat-panel-section__title">
                        Queued Messages ({queuedMessages.length})
                      </h3>
                    </Accordion.Control>
                    <Accordion.Panel
                      style={{
                        maxHeight: '200px',
                        overflowY: 'auto',
                        padding: '8px 0',
                      }}
                    >
                      <div className="chat-queued-messages">
                        {queuedMessages.length === 0 ? (
                          <p className="chat-panel-empty">
                            No messages queued. Type in the box and press Enter
                            to queue while agent is working.
                          </p>
                        ) : (
                          <ul className="chat-queued-messages__list">
                            {queuedMessages.map((msg, i) => (
                              <li
                                key={msg.id}
                                className="chat-queued-messages__item"
                              >
                                <span className="chat-queued-messages__content">
                                  {msg.content}
                                </span>
                                <Button
                                  type="button"
                                  variant="subtle"
                                  size="compact-xs"
                                  color="red"
                                  onClick={() =>
                                    setQueuedMessages((prev) =>
                                      prev.filter((_, idx) => idx !== i)
                                    )
                                  }
                                  title="Remove from queue"
                                  aria-label="Remove from queue"
                                >
                                  ×
                                </Button>
                              </li>
                            ))}
                          </ul>
                        )}
                        {queuedMessages.length > 0 && (
                          <div className="chat-queued-messages__actions">
                            <Button
                              type="button"
                              size="xs"
                              variant="subtle"
                              onClick={() => {
                                // Send all queued messages
                                queuedMessages.forEach((msg) => {
                                  sendMessage.mutate({
                                    sessionId: sessionId!,
                                    content: buildMessageContent(
                                      msg.content
                                    ),
                                    modeId,
                                    providerId: effectiveProviderId ?? defaultProviderId,
                                    ...(effectiveModelId ? { model: effectiveModelId } : {}),
                                  });
                                  // Clear attachments after sending
                                  setAttachments([]);
                                });
                                setQueuedMessages([]);
                              }}
                              disabled={isRunInProgress || !queuedMessages.length}
                            >
                              Send All
                            </Button>
                          </div>
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
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownCodeComponents}>
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
            {addAttachmentModalOpen && (
              <div
                className="context-modal-overlay plan-modal-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="add-attachment-modal-title"
                onClick={(e) =>
                  e.target === e.currentTarget && setAddAttachmentModalOpen(false)
                }
              >
                <div className="context-modal plan-modal rule-modal">
                  <div className="context-modal__header">
                    <h2 id="add-attachment-modal-title">Add an attachment</h2>
                    <ActionIcon
                      type="button"
                      variant="subtle"
                      size="sm"
                      onClick={() => setAddAttachmentModalOpen(false)}
                      aria-label="Close"
                    >
                      ×
                    </ActionIcon>
                  </div>
                  <div className="context-modal__body plan-modal__body rule-modal__body">
                    <div className="rule-modal__name-row" style={{ marginBottom: 12 }}>
                      <label htmlFor="attachment-name">Name</label>
                      <TextInput
                        id="attachment-name"
                        placeholder="e.g. Example response"
                        value={newAttachmentName}
                        onChange={(e) =>
                          setNewAttachmentName(e.currentTarget.value)
                        }
                        size="sm"
                      />
                    </div>
                    <div style={{ marginBottom: 16 }}>
                      <label htmlFor="attachment-content">Content</label>
                      <Textarea
                        id="attachment-content"
                        value={newAttachmentContent}
                        onChange={(e) =>
                          setNewAttachmentContent(e.currentTarget.value)
                        }
                        placeholder="Paste or type content to attach (e.g. examples for the agent). This will be included with your messages."
                        minRows={8}
                        autosize
                        styles={{ input: { fontFamily: 'inherit' } }}
                      />
                    </div>
                    <div className="rule-modal__actions">
                      <Button
                        type="button"
                        variant="subtle"
                        onClick={() => setAddAttachmentModalOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        disabled={!newAttachmentName.trim()}
                        onClick={() => {
                          const name = newAttachmentName.trim();
                          if (!name) return;
                          setAttachments((prev) => [
                            ...prev,
                            { type: 'text', name, content: newAttachmentContent },
                          ]);
                          setNewAttachmentName('');
                          setNewAttachmentContent('');
                          setAddAttachmentModalOpen(false);
                        }}
                      >
                        Add
                      </Button>
                    </div>
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
