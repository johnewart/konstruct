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
} from '@mantine/core';
import { useMantineColorScheme, useComputedColorScheme } from '@mantine/core';
import { IconSun, IconMoon, IconTerminal, IconSettings } from '@tabler/icons-react';
import { DocumentPage } from './pages/Document';
import { Chat } from './pages/Chat';
import { ConfigurationPage } from './pages/Configuration';
import { FallbackCli } from './fallback-cli/FallbackCli';
import { trpc } from '../client/trpc';
import { DiffViewerPage } from './pages/DiffViewer';
import { CodeExplorerPage } from './pages/CodeExplorerPage';
import { PullRequestsPage } from './pages/PullRequestsPage';
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
        {computed === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
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

function TopNav() {
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
            display: 'flex',
            alignItems: 'center',
          }}
        >
          Code explorer
        </Box>
      </Group>
      <Group gap="md">
        <TopNavProjectSelector />
        <ThemeToggle />
        <Tooltip label="Configuration">
          <ActionIcon
            component={Link}
            to="/config"
            variant={isConfig ? 'light' : 'subtle'}
            color="blue"
            aria-label="Configuration"
          >
            <IconSettings size={18} />
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
            <IconTerminal size={18} />
          </ActionIcon>
        </Tooltip>
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
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          overflow: 'hidden',
          ['--app-topnav-height' as string]: '52px',
        }}
      >
        <TopNav />
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
          </Routes>
        </Box>
      </Box>
    </BrowserRouter>
  );
}

export default App;
