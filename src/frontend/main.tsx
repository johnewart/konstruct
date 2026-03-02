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

import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  MantineProvider,
  ColorSchemeScript,
  localStorageColorSchemeManager,
} from '@mantine/core';
import '@mantine/core/styles.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink, loggerLink } from '@trpc/client';
import { trpc } from '../client/trpc';
import { queryClient } from './queryClient';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FallbackCli } from './fallback-cli/FallbackCli';
import App from './App';

const links = [
  ...(import.meta.env.DEV
    ? [
        loggerLink({
          console: {
            log: (...args: unknown[]) =>
              console.log('[frontend] tRPC', ...args),
            error: (...args: unknown[]) =>
              console.error('[frontend] tRPC', ...args),
          },
        }),
      ]
    : []),
  httpBatchLink({
    url: '/trpc',
    methodOverride: 'POST',
  }),
];

const trpcClient = trpc.createClient({ links });

const colorSchemeManager = localStorageColorSchemeManager({
  key: 'konstruct-color-scheme',
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ColorSchemeScript defaultColorScheme="light" />
    <MantineProvider
      colorSchemeManager={colorSchemeManager}
      defaultColorScheme="light"
    >
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <ErrorBoundary fallback={<FallbackCli />}>
            <App />
          </ErrorBoundary>
        </QueryClientProvider>
      </trpc.Provider>
    </MantineProvider>
  </React.StrictMode>
);
