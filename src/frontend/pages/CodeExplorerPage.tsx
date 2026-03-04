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
  Table,
  ScrollArea,
  Badge,
} from '@mantine/core';
import { trpc } from '../../client/trpc';

const CARD_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--app-surface)',
  border: '1px solid var(--app-border)',
  borderRadius: 8,
  boxShadow: '0 2px 8px var(--app-shadow)',
  overflow: 'hidden',
};

export function CodeExplorerPage() {
  const [pathArg, setPathArg] = useState('src');
  const { data, isLoading, error } = trpc.codebase.getDependencyGraph.useQuery(
    { path: pathArg || '.' },
    { enabled: true }
  );

  const nodes = data?.nodes ?? [];
  const edges = data?.edges ?? [];
  const apiError = data?.error ?? null;
  const truncated = data?.truncated ?? false;

  return (
    <Stack p="md" gap="md" style={{ height: 'calc(100vh - var(--app-topnav-height) - 32px)', minHeight: 0 }}>
      <Group justify="space-between" wrap="nowrap">
        <Title order={3}>Code explorer</Title>
        <TextInput
          placeholder="Path (e.g. src or .)"
          value={pathArg}
          onChange={(e) => setPathArg(e.currentTarget.value)}
          size="sm"
          style={{ maxWidth: 220 }}
        />
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

      {isLoading ? (
        <Text size="sm" c="dimmed">
          Building dependency graph…
        </Text>
      ) : (
        <Group align="stretch" gap="md" wrap="nowrap" style={{ flex: 1, minHeight: 0 }}>
          <Card withBorder padding="md" style={{ ...CARD_STYLE, flex: 1, minWidth: 280, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Title order={5} mb="xs">
              Files ({nodes.length})
            </Title>
            <ScrollArea style={{ flex: 1, minHeight: 0 }}>
              {nodes.length === 0 ? (
                <Text size="sm" c="dimmed">
                  No files with parseable dependencies in this path.
                </Text>
              ) : (
                <Stack gap={4}>
                  {nodes.map((node) => (
                    <Box
                      key={node.path}
                      style={{
                        padding: '6px 8px',
                        borderRadius: 4,
                        backgroundColor: 'var(--app-hover)',
                        fontFamily: 'monospace',
                        fontSize: 12,
                      }}
                    >
                      {node.path}
                    </Box>
                  ))}
                </Stack>
              )}
            </ScrollArea>
          </Card>

          <Card withBorder padding="md" style={{ ...CARD_STYLE, flex: 2, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Title order={5} mb="xs">
              Dependencies ({edges.length})
            </Title>
            <ScrollArea style={{ flex: 1, minHeight: 0 }}>
              {edges.length === 0 ? (
                <Text size="sm" c="dimmed">
                  No import/export/require edges found.
                </Text>
              ) : (
                <Table striped highlightOnHover withTableBorder withColumnBorders layout="fixed">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th style={{ width: '40%' }}>Source</Table.Th>
                      <Table.Th style={{ width: '40%' }}>Target</Table.Th>
                      <Table.Th style={{ width: 100 }}>Type</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {edges.map((edge, i) => (
                      <Table.Tr key={`${edge.source}-${edge.target}-${i}`}>
                        <Table.Td style={{ fontFamily: 'monospace', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {edge.source}
                        </Table.Td>
                        <Table.Td style={{ fontFamily: 'monospace', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {edge.target}
                        </Table.Td>
                        <Table.Td>
                          <Badge size="xs" variant="light">
                            {edge.type}
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </ScrollArea>
          </Card>
        </Group>
      )}
    </Stack>
  );
}

export default CodeExplorerPage;
