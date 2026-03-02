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
import { IconSun, IconMoon } from '@tabler/icons-react';
import { DocumentPage } from './pages/Document';
import { Chat } from './pages/Chat';
import { ConfigurationPage } from './pages/Configuration';
import { FallbackCli } from './fallback-cli/FallbackCli';
import { trpc } from '../client/trpc';
import './index.css';

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

function TopNavProjectSelector() {
  const utils = trpc.useUtils();
  const { data: projects = [] } = trpc.projects.list.useQuery();
  const { data: active } = trpc.projects.getActive.useQuery();
  const setActive = trpc.projects.setActive.useMutation({
    onSuccess: () => {
      void utils.projects.getActive.invalidate();
    },
  });

  const options = [
    { value: '', label: 'No project' },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];

  return (
    <Select
      value={active?.id ?? ''}
      onChange={(value) => {
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
          to="/config"
          style={{
            fontWeight: isConfig ? 600 : 400,
            color: 'var(--app-text)',
            textDecoration: 'none',
            fontSize: 14,
          }}
        >
          Configuration
        </Link>
        <Link
          to="/cli"
          style={{
            fontWeight: isCli ? 600 : 400,
            color: 'var(--app-text)',
            textDecoration: 'none',
            fontSize: 14,
          }}
        >
          CLI
        </Link>
      </Group>
      <Group gap="md">
        <TopNavProjectSelector />
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
          <Route path="/config" element={<ConfigurationPage />} />
          <Route path="/runpod" element={<Navigate to="/config?tab=runpod" replace />} />
          <Route path="/vms" element={<Navigate to="/config?tab=vms" replace />} />
          <Route path="/projects" element={<Navigate to="/config?tab=projects" replace />} />
          <Route path="/providers" element={<Navigate to="/config?tab=providers" replace />} />
          <Route path="/cli" element={<FallbackCli />} />
        </Routes>
      </Box>
    </BrowserRouter>
  );
}

export default App;
