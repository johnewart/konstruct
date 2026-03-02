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

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Box, Button, Code, Paper, Stack, Text, Group } from '@mantine/core';
import { IconRefresh, IconCopy } from '@tabler/icons-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional fallback when no custom fallback is rendered (error is still shown above it). */
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Catches React rendering errors in the subtree and shows a safe fallback UI
 * instead of a blank screen. Does not catch errors in event handlers or async code.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState((s) => ({ ...s, errorInfo }));
    console.error('[ErrorBoundary] Caught rendering error:', error, errorInfo);
  }

  handleReload = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  handleCopyError = (): void => {
    const { error, errorInfo } = this.state;
    if (!error) return;
    const parts = [
      error.name && error.name !== 'Error' ? `${error.name}: ${error.message}` : error.message,
      error.stack ?? '',
      errorInfo?.componentStack ? `\nComponent stack:\n${errorInfo.componentStack}` : '',
    ].filter(Boolean);
    void navigator.clipboard.writeText(parts.join('\n'));
  };

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      const { error } = this.state;
      const message = error?.message ?? 'Unknown error';
      const stack = this.state.errorInfo?.componentStack ?? error?.stack ?? null;
      const errorBlock = (
        <Paper p="md" radius={0} withBorder style={{ borderLeft: 0, borderRight: 0, borderTop: 0, backgroundColor: 'var(--mantine-color-red-0)' }}>
          <Stack gap="xs">
            <Group justify="space-between">
              <Text size="sm" fw={600} c="red">Error (copy to report)</Text>
              <Button size="xs" variant="light" leftSection={<IconCopy size={14} />} onClick={this.handleCopyError}>
                Copy error
              </Button>
            </Group>
            <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, maxHeight: 200, overflow: 'auto' }}>
              {[message, stack, this.state.errorInfo?.componentStack].filter(Boolean).join('\n\n')}
            </Code>
          </Stack>
        </Paper>
      );

      if (this.props.fallback) {
        return (
          <Box style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--mantine-color-default)' }}>
            {errorBlock}
            {this.props.fallback}
          </Box>
        );
      }

      return (
        <Box
          p="xl"
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--mantine-color-default)',
          }}
        >
          <Paper p="xl" shadow="md" radius="md" withBorder maw={560}>
            <Stack gap="md">
              <Text size="lg" fw={600} c="red">
                Something went wrong
              </Text>
              <Text size="sm" c="dimmed">
                A rendering error was caught. You can reload the page to try again.
              </Text>
              <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {message}
              </Code>
              {stack && (
                <Details label="Component stack" content={stack} />
              )}
              <Button
                leftSection={<IconRefresh size={16} />}
                onClick={this.handleReload}
                variant="light"
              >
                Reload page
              </Button>
            </Stack>
          </Paper>
        </Box>
      );
    }

    return this.props.children;
  }
}

function Details({ label, content }: { label: string; content: string }) {
  return (
    <details>
      <summary style={{ cursor: 'pointer', fontSize: 'var(--mantine-font-size-sm)', color: 'var(--mantine-color-dimmed)' }}>
        {label}
      </summary>
      <Code block mt="xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 11, maxHeight: 200, overflow: 'auto' }}>
        {content}
      </Code>
    </details>
  );
}
