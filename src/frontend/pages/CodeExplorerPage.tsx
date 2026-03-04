/*
 * Copyright 2026 John Ewart <john@johnewart.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use it except in compliance with the License.
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

import { useState } from 'react';
import {
  Box,
  Title,
  Text,
  Stack,
  Group,
  TextInput,
  Alert,
  Card,
  Progress,
  Button,
} from '@mantine/core';
import { trpc } from '../../client/trpc';
import { DependencyGraphForceChart } from '../components/DependencyGraphForceChart';

const CARD_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--app-surface)',
  border: '1px solid var(--app-border)',
  borderRadius: 8,
  boxShadow: '0 2px 8px var(--app-shadow)',
  overflow: 'hidden',
};

export function CodeExplorerPage() {
  const [pathArg, setPathArg] = useState('src');
  const { data, isLoading, error, refetch } = trpc.codebase.getDependencyGraph.useQuery(
    { path: pathArg || '.' },
    {
      enabled: true,
      refetchInterval: (query) => (query.state.data?.building ? 500 : false),
    }
  );

  const invalidateGraph = trpc.codebase.invalidateDependencyGraph.useMutation({
    onSuccess: () => refetch(),
  });

  const handleRebuild = () => {
    invalidateGraph.mutate({ path: pathArg || '.' });
  };

  const building = data?.building ?? false;
  const buildPhase = data?.phase ?? 'parsing';
  const filesProcessed = data?.filesProcessed ?? 0;
  const totalFiles = data?.totalFiles ?? 0;
  const currentDir = data?.currentDir ?? '';
  const nodes = data?.nodes ?? [];
  const edges = data?.edges ?? [];
  const apiError = data?.error ?? null;
  const truncated = data?.truncated ?? false;

  return (
    <Stack p="md" gap="md" style={{ height: 'calc(100vh - var(--app-topnav-height) - 32px)', minHeight: 0 }}>
      <Group justify="space-between" wrap="nowrap">
        <Title order={3}>Code explorer</Title>
        <Group wrap="nowrap" gap="xs">
          <TextInput
            placeholder="Path (e.g. src or .)"
            value={pathArg}
            onChange={(e) => setPathArg(e.currentTarget.value)}
            size="sm"
            style={{ maxWidth: 220 }}
          />
          <Button
            size="sm"
            variant="light"
            loading={invalidateGraph.isPending}
            onClick={handleRebuild}
          >
            Rebuild graph
          </Button>
        </Group>
      </Group>

      {error && (
        <Alert color="red" title="Error">
          {error.message}
        </Alert>
      )}

      {apiError && (
        <Alert color="amber" title="Dependency graph unavailable">
          {apiError}
        </Alert>
      )}

      {truncated && (
        <Alert color="blue" title="Results truncated">
          Narrow the path (e.g. src/backend) to see the full graph for a subset.
        </Alert>
      )}

      {building && (
        <Card withBorder padding="md" style={CARD_STYLE}>
          <Text size="sm" fw={500} mb="xs">
            {totalFiles > 0
              ? `Building dependency graph… ${filesProcessed} of ${totalFiles} files processed`
              : buildPhase === 'discovering'
                ? `Discovering files in ${currentDir || '.'}… ${filesProcessed} found so far`
                : 'Discovering files…'}
          </Text>
          <Progress
            value={totalFiles > 0 ? Math.round((filesProcessed / totalFiles) * 100) : undefined}
            size="md"
            striped
            animated={totalFiles === 0}
          />
        </Card>
      )}

      {!building && (isLoading && !data ? (
        <Text size="sm" c="dimmed">
          Loading…
        </Text>
      ) : (
        (nodes.length > 0 || edges.length > 0) ? (
          <Card withBorder padding={0} style={{ ...CARD_STYLE, flex: 1, minHeight: 400, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Box p="xs" style={{ borderBottom: '1px solid var(--app-border)' }}>
              <Text size="xs" c="dimmed">D3 force-directed · {nodes.length} nodes · {edges.length} links</Text>
            </Box>
            <Box style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              <DependencyGraphForceChart nodes={nodes} edges={edges} />
            </Box>
          </Card>
        ) : (
          <Text size="sm" c="dimmed">No files or dependencies in this path. Try a different path (e.g. src or .).</Text>
        ))
      )}
    </Stack>
  );
}

export default CodeExplorerPage;
