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

import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Link,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { useState, useEffect, useMemo } from 'react';
import {
  ActionIcon,
  Tooltip,
  Box,
  Group,
  Select,
  Text,
} from '@mantine/core';
import { useMantineColorScheme, useComputedColorScheme } from '@mantine/core';
import { IconSun, IconMoon } from '@tabler/icons-react';
import { DocumentPage } from './pages/Document';
import { Chat } from './pages/Chat';
import { RunPodPage } from './pages/RunPod';
import { trpc } from '../client/trpc';
import './index.css';

const RUNPOD_CONFIG_KEY = 'runpod-config';
const CHAT_PROVIDER_KEY = 'chat-provider-id';

function ThemeToggle() {
  const { toggleColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme('light');
  return (
    <Tooltip label={computed === 'dark' ? 'Light mode' : 'Dark mode'}>
      <ActionIcon
        variant="subtle"
        size="lg"
        onClick={() => toggleColorScheme()}
        aria-label={
          computed === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
        }
      >
        {computed === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
      </ActionIcon>
    </Tooltip>
  );
}

function TopNavProviderSelector() {
  const [providerId, setProviderId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(CHAT_PROVIDER_KEY);
  });

  const { data: providersData } = trpc.chat.listProviders.useQuery();
  const providers = providersData?.providers ?? [];
  const defaultProviderId = providersData?.defaultProviderId ?? 'openai';

  // Sync with localStorage when providers change
  useEffect(() => {
    if (providers.length === 0) return;
    const inList = providerId != null && providers.some((p) => p.id === providerId);
    if (inList) return;
    const next =
      defaultProviderId && providers.some((p) => p.id === defaultProviderId)
        ? defaultProviderId
        : providers[0].id;
    setProviderId(next);
    if (typeof window !== 'undefined')
      localStorage.setItem(CHAT_PROVIDER_KEY, next);
  }, [providers, defaultProviderId]);

  const handleProviderChange = (value: string | null) => {
    setProviderId(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem(CHAT_PROVIDER_KEY, value ?? '');
    }
  };

  if (providers.length === 0) return null;

  return (
    <Select
      value={providerId ?? ''}
      onChange={(value) => handleProviderChange(value)}
      data={providers.map((p) => ({ value: p.id, label: p.name }))}
      size="xs"
      w={160}
      styles={{
        input: {
          fontSize: '0.8em',
          fontWeight: 500,
        },
      }}
    />
  );
}

function TopNavRunPodStatus() {
  const [providerId, setProviderId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(CHAT_PROVIDER_KEY);
  });

  const { data: defaultPodData } = trpc.runpod.getDefaultRunpodPod.useQuery(
    undefined,
    { enabled: providerId === 'runpod' }
  );
  const [runpodPods, setRunpodPods] = useState<
    Array<{ id: string; name?: string; status?: string }>
  >([]);
  const getPodsMutation = trpc.runpod.getPods.useMutation();

  useEffect(() => {
    if (providerId !== 'runpod') return;
    const raw = localStorage.getItem(RUNPOD_CONFIG_KEY);
    if (!raw) return;
    try {
      const config = JSON.parse(raw) as { apiKey?: string; endpoint?: string };
      if (config?.apiKey && defaultPodData?.defaultPodId) {
        getPodsMutation.mutate(
          { apiKey: config.apiKey, endpoint: config.endpoint },
          {
            onSuccess: (res) => {
              if (res.success && res.pods) setRunpodPods(res.pods);
            },
          }
        );
      }
    } catch {
      // ignore
    }
  }, [providerId, defaultPodData?.defaultPodId]);

  const pod = useMemo(
    () =>
      defaultPodData?.defaultPodId && runpodPods.length
        ? runpodPods.find((p) => p.id === defaultPodData.defaultPodId)
        : null,
    [defaultPodData?.defaultPodId, runpodPods]
  );
  const runpodStatus = pod?.status?.toUpperCase() ?? null;
  const runpodIsRunning = runpodStatus === 'RUNNING';

  if (providerId !== 'runpod' || !pod) return null;

  return (
    <Tooltip
      label={
        runpodIsRunning
          ? `Pod ${pod.name || pod.id} is running`
          : `Pod ${pod.name || pod.id} status: ${runpodStatus || 'Unknown'}`
      }
    >
      <Group gap="sm" style={{ fontSize: '0.8em' }}>
        <Text
          span
          style={{
            fontWeight: 500,
            color: runpodIsRunning ? 'var(--mantine-color-green)' : 'var(--mantine-color-red)',
          }}
        >
          {runpodIsRunning ? '●' : '○'} Pod
        </Text>
        <Text span>{pod.name || pod.id}</Text>
      </Group>
    </Tooltip>
  );
}

function TopNav() {
  const location = useLocation();
  const isChat =
    location.pathname === '/' || location.pathname.startsWith('/chat/');
  const isRunPod = location.pathname === '/runpod';
  const navigate = useNavigate();

  return (
    <Group
      justify="space-between"
      px="md"
      py="xs"
      style={{
        borderBottom: '1px solid var(--app-border)',
        background: 'var(--app-surface)',
      }}
    >
      <Group gap="md">
        <Link
          to="/"
          style={{
            fontWeight: isChat ? 600 : 400,
            color: 'var(--app-text)',
            textDecoration: 'none',
            fontSize: 14,
          }}
        >
          Chat
        </Link>
        <Link
          to="/runpod"
          style={{
            fontWeight: isRunPod ? 600 : 400,
            color: 'var(--app-text)',
            textDecoration: 'none',
            fontSize: 14,
          }}
        >
          Configure RunPod
        </Link>
      </Group>
      <Group gap="md">
        <TopNavProviderSelector />
        <TopNavRunPodStatus />
        <ThemeToggle />
      </Group>
    </Group>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Box
        component="div"
        style={{
          position: 'relative',
          ['--app-topnav-height' as string]: '52px',
        }}
      >
        <TopNav />
        <Routes>
          <Route path="/" element={<Chat />} />
          <Route path="/chat" element={<Navigate to="/" replace />} />
          <Route path="/chat/:sessionId" element={<Chat />} />
          <Route path="/doc/:id" element={<DocumentPage />} />
          <Route path="/runpod" element={<RunPodPage />} />
        </Routes>
      </Box>
    </BrowserRouter>
  );
}

export default App;
