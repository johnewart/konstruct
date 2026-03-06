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
import { useState, useEffect, useMemo, Suspense } from 'react';
import {
  ActionIcon,
  Tooltip,
  Box,
  Group,
  Select,
  Menu,
  Button,
  Modal,
  Text,
} from '@mantine/core';
import { useMantineColorScheme, useComputedColorScheme } from '@mantine/core';
import { IconSun, IconMoon, IconTerminal, IconSettings, IconRefresh } from '@tabler/icons-react';
import { ProjectModelProvider, useProjectModel } from './contexts/ProjectModelContext';
import { DocumentPage } from './pages/Document';
import { Chat } from './pages/Chat';
import { ConfigurationPage } from './pages/Configuration';
import { FallbackCli } from './fallback-cli/FallbackCli';
import { trpc } from '../client/trpc';
import { DiffViewerPage } from './pages/DiffViewer';
import { CodeExplorerPage } from './pages/CodeExplorerPage';
import { PullRequestsPage } from './pages/PullRequestsPage';
import { usePluginViews } from './plugins/usePluginViews';
import type { PluginViewEntry } from './plugins/usePluginViews';
import './index.css';

function ThemeToggle() {
  const { toggleColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme('light');
  return (
    <Tooltip label={computed === 'dark' ? 'Light mode' : 'Dark mode'}>
      <ActionIcon
        variant="subtle"
        size="lg"
        color="blue"
        onClick={() => toggleColorScheme()}
        aria-label={
          computed === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
        }
      >
        {computed === 'dark' ? <IconSun size={14} stroke={1} /> : <IconMoon size={14} stroke={1} />}
      </ActionIcon>
    </Tooltip>
  );
}

const ACTIVE_PROJECT_STORAGE_KEY = 'konstruct-active-project-id';

function TopNavProjectSelector() {
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const { data: projects = [] } = trpc.projects.list.useQuery();
  const { data: active } = trpc.projects.getActive.useQuery();
  const setActive = trpc.projects.setActive.useMutation({
    onSuccess: () => {
      void utils.projects.getActive.invalidate();
      void utils.sessions.list.invalidate();
      void utils.chat.listProviders.invalidate();
      void utils.git.getGitDiff.invalidate();
      void utils.git.getChangedFiles.invalidate();
      void utils.review.getOrCreateSession.invalidate();
      void utils.github.getRepo.invalidate();
      void utils.github.listPullRequests.invalidate();
      navigate('/');
    },
  });

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    const id = active?.id ?? '';
    localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, id);
  }, [active?.id]);

  const options = [
    { value: '', label: 'No project' },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];

  return (
    <Select
      value={active?.id ?? ''}
      onChange={(value) => {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, value ?? '');
        }
        setActive.mutate({ projectId: value === '' ? null : value });
      }}
      data={options}
      size="xs"
      w={180}
      placeholder="Project"
      styles={{
        input: {
          fontSize: '0.8em',
          fontWeight: 500,
        },
      }}
    />
  );
}

function TopNavModelSelector() {
  const { projectId, providerId, modelId, setProjectModel, isProjectScope } = useProjectModel();
  const { data: providersData } = trpc.chat.listProviders.useQuery(undefined, {
    enabled: isProjectScope,
  });
  const { data: defaultPodData } = trpc.runpod.getDefaultRunpodPod.useQuery(undefined, {
    enabled: isProjectScope && providerId === 'runpod',
  });
  const { data: runpodModelsData } = trpc.runpod.getRunpodModels.useQuery(
    { podId: defaultPodData?.defaultPodId ?? '' },
    { enabled: isProjectScope && providerId === 'runpod' && !!defaultPodData?.defaultPodId }
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
      const isClaudeCliOrSdk = providerType === 'claude_sdk';
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

  const currentLabel =
    providerId && allModelOptions.length > 0
      ? (() => {
          const opt = allModelOptions.find((o) => o.providerId === providerId && o.modelId === modelId);
          return opt ? `${opt.providerName}: ${opt.modelName}` : (modelId ?? providerId ?? '—');
        })()
      : defaultProviderId && configuredProviders.some((p) => p.id === defaultProviderId)
        ? 'Set model…'
        : 'Set model…';

  if (!isProjectScope || !projectId) return null;

  return (
    <Menu position="bottom-end" width={260} shadow="md">
      <Menu.Target>
        <Tooltip label="Project model (used by all agents in this project)">
          <Button
            size="xs"
            variant="subtle"
            compact
            style={{
              minWidth: 0,
              maxWidth: 200,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              fontSize: '0.8rem',
            }}
          >
            {currentLabel}
          </Button>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Provider / Model (project-wide)</Menu.Label>
        {allModelOptions.length === 0 ? (
          <Menu.Item disabled>No models available</Menu.Item>
        ) : (
          allModelOptions.map((opt) => {
            const isSelected = providerId === opt.providerId && modelId === opt.modelId;
            return (
              <Menu.Item
                key={`${opt.providerId}:${opt.modelId}`}
                onClick={() => setProjectModel(opt.providerId, opt.modelId)}
                style={{ fontWeight: isSelected ? 600 : undefined }}
              >
                {opt.providerName}: {opt.modelName}
              </Menu.Item>
            );
          })
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

function TopNav({ pluginViews = [] }: { pluginViews?: PluginViewEntry[] }) {
  const location = useLocation();
  const isChat =
    location.pathname === '/' || location.pathname.startsWith('/chat/');
  const isConfig =
    location.pathname === '/config' ||
    location.pathname === '/runpod' ||
    location.pathname === '/vms' ||
    location.pathname === '/projects' ||
    location.pathname === '/providers';
  const isCli = location.pathname === '/cli';
  const isDiff = location.pathname === '/diff';
  const isPr = location.pathname === '/pr';
  const isCodeExplorer = location.pathname === '/code-explorer';

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
      <Group gap={0} style={{ alignItems: 'stretch' }}>
        <Box
          component={Link}
          to="/"
          style={{
            fontWeight: isChat ? 600 : 500,
            color: 'var(--app-text)',
            textDecoration: 'none',
            fontSize: 14,
            paddingRight: 16,
            marginRight: 16,
            borderRight: '1px solid var(--app-border)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          Chat
        </Box>
        <Box
          component={Link}
          to="/diff"
          style={{
            fontWeight: isDiff ? 600 : 500,
            color: 'var(--app-text)',
            textDecoration: 'none',
            fontSize: 14,
            paddingRight: 16,
            marginRight: 16,
            borderRight: '1px solid var(--app-border)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          Local Changes
        </Box>
        <Box
          component={Link}
          to="/pr"
          style={{
            fontWeight: isPr ? 600 : 500,
            color: 'var(--app-text)',
            textDecoration: 'none',
            fontSize: 14,
            paddingRight: 16,
            marginRight: 16,
            borderRight: '1px solid var(--app-border)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          Pull requests
        </Box>
        <Box
          component={Link}
          to="/code-explorer"
          style={{
            fontWeight: isCodeExplorer ? 600 : 500,
            color: 'var(--app-text)',
            textDecoration: 'none',
            fontSize: 14,
            paddingRight: 16,
            marginRight: 16,
            borderRight: '1px solid var(--app-border)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          Code explorer
        </Box>
        {pluginViews.map((p) => (
          <Box
            key={p.id}
            component={Link}
            to={p.path}
            style={{
              fontWeight: location.pathname === p.path ? 600 : 500,
              color: 'var(--app-text)',
              textDecoration: 'none',
              fontSize: 14,
              paddingRight: 16,
              marginRight: 16,
              borderRight: '1px solid var(--app-border)',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {p.label}
          </Box>
        ))}
      </Group>
      <Group gap="md">
        <TopNavProjectSelector />
        <TopNavModelSelector />
        <ThemeToggle />
        <Tooltip label="Configuration">
          <ActionIcon
            component={Link}
            to="/config"
            variant={isConfig ? 'light' : 'subtle'}
            color="blue"
            aria-label="Configuration"
          >
            <IconSettings size={14} stroke={1} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Shell">
          <ActionIcon
            component={Link}
            to="/cli"
            variant={isCli ? 'light' : 'subtle'}
            color="blue"
            aria-label="Shell"
          >
            <IconTerminal size={14} stroke={1} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  );
}

function RestartNeededBanner() {
  const { data } = trpc.plugins.getRestartNeeded.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const restartServer = trpc.plugins.restartServer.useMutation({
    onMutate: () => setConfirmOpen(false),
  });

  if (!data?.restartNeeded) return null;

  return (
    <>
      <Box
        px="md"
        py="xs"
        style={{
          background: 'var(--mantine-color-yellow-2)',
          borderBottom: '1px solid var(--mantine-color-yellow-4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <Group gap="xs" style={{ flex: 1, minWidth: 0 }}>
          <IconRefresh size={18} style={{ flexShrink: 0 }} />
          <Text size="sm" fw={500}>
            Restart required to apply plugin changes.
          </Text>
        </Group>
        <Button
          size="xs"
          variant="light"
          color="dark"
          leftSection={<IconRefresh size={14} />}
          onClick={() => setConfirmOpen(true)}
          aria-label="Restart server"
        >
          Restart now
        </Button>
      </Box>
      <Modal
        opened={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Restart server?"
        centered
      >
        <Text size="sm" c="dimmed" mb="md">
          The server will exit so plugin changes can take effect. If you run it with a process
          manager (e.g. systemd, PM2) or restart the dev command, it will come back and the app
          will reconnect.
        </Text>
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
          <Button
            color="yellow"
            loading={restartServer.isPending}
            onClick={() => restartServer.mutate()}
            leftSection={<IconRefresh size={14} />}
          >
            Restart
          </Button>
        </Group>
      </Modal>
    </>
  );
}

function AppContent() {
  const { views: pluginViews } = usePluginViews();
  return (
    <>
      <RestartNeededBanner />
      <TopNav pluginViews={pluginViews} />
      <Box
        component="main"
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
        }}
      >
        <Routes>
          <Route path="/" element={<Chat />} />
          <Route path="/chat" element={<Navigate to="/" replace />} />
          <Route path="/chat/:sessionId" element={<Chat />} />
          <Route path="/doc/:id" element={<DocumentPage />} />
          <Route path="/config" element={<ConfigurationPage />} />
          <Route path="/runpod" element={<Navigate to="/config?tab=runpod" replace />} />
          <Route path="/vms" element={<Navigate to="/config?tab=vms" replace />} />
          <Route path="/projects" element={<Navigate to="/config?tab=projects" replace />} />
          <Route path="/providers" element={<Navigate to="/config?tab=providers" replace />} />
          <Route path="/cli" element={<FallbackCli />} />
          <Route path="/diff" element={<DiffViewerPage />} />
          <Route path="/pr" element={<PullRequestsPage />} />
          <Route path="/code-explorer" element={<CodeExplorerPage />} />
          {pluginViews.map((p) => (
            <Route
              key={p.id}
              path={p.path}
              element={
                <Suspense fallback={null}>
                  <p.Component />
                </Suspense>
              }
            />
          ))}
        </Routes>
      </Box>
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <ProjectModelProvider>
      <Box
        component="div"
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          overflow: 'hidden',
          ['--app-topnav-height' as string]: '52px',
        }}
      >
        <AppContent />
      </Box>
      </ProjectModelProvider>
    </BrowserRouter>
  );
}

export default App;
