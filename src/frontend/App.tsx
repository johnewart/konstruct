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
} from 'react-router-dom';
import { ActionIcon, Tooltip, Box, Group } from '@mantine/core';
import { useMantineColorScheme, useComputedColorScheme } from '@mantine/core';
import { IconSun, IconMoon } from '@tabler/icons-react';
import { DocumentPage } from './pages/Document';
import { Chat } from './pages/Chat';
import { RunPodPage } from './pages/RunPod';
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

function TopNav() {
  const location = useLocation();
  const isChat =
    location.pathname === '/' || location.pathname.startsWith('/chat/');
  const isRunPod = location.pathname === '/runpod';
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
      <ThemeToggle />
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
