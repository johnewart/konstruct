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
import { trpc } from './trpc';
import { queryClient } from './queryClient';
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
          <App />
        </QueryClientProvider>
      </trpc.Provider>
    </MantineProvider>
  </React.StrictMode>
);
