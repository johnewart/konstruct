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

import { useState, useEffect, useRef, useMemo } from 'react';
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
  Tabs,
  UnstyledButton,
  ScrollArea,
  List,
} from '@mantine/core';
import { IconChevronRight, IconChevronDown, IconFile } from '@tabler/icons-react';
import { trpc } from '../../client/trpc';
import { DependencyGraphForceChart } from '../components/DependencyGraphForceChart';

const CARD_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--app-surface)',
  border: '1px solid var(--app-border)',
  borderRadius: 8,
  boxShadow: '0 2px 8px var(--app-shadow)',
  overflow: 'hidden',
};

type FileTreeNode =
  | { type: 'folder'; name: string; children: Map<string, FileTreeNode> }
  | { type: 'file'; name: string; path: string };

function buildFileTree(paths: string[]): Map<string, FileTreeNode> {
  const root = new Map<string, FileTreeNode>();
  for (const p of paths) {
    const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      if (isLast) {
        current.set(part, { type: 'file', name: part, path: p });
      } else {
        let node = current.get(part);
        if (!node || node.type === 'file') {
          node = { type: 'folder', name: part, children: new Map() };
          current.set(part, node);
        }
        current = (node as { type: 'folder'; children: Map<string, FileTreeNode> }).children;
      }
    }
  }
  return root;
}

function sortFileTreeEntries(entries: [string, FileTreeNode][]): [string, FileTreeNode][] {
  return [...entries].sort(([a, aNode], [b, bNode]) => {
    const aIsFolder = aNode.type === 'folder';
    const bIsFolder = bNode.type === 'folder';
    if (aIsFolder && !bIsFolder) return -1;
    if (!aIsFolder && bIsFolder) return 1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
}

function normalizePathForCompare(p: string): string {
  return p.replace(/\\/g, '/').trim();
}

export function CodeExplorerPage() {
  const [pathArg, setPathArg] = useState('.');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const { data, isLoading, error, refetch } = trpc.codebase.getDependencyGraph.useQuery(
    { path: pathArg || '.' },
    {
      enabled: true,
      refetchInterval: (query) => {
        const d = query.state.data;
        if (!d?.building) return false;
        const total = d.totalFiles ?? 0;
        const done = d.filesProcessed ?? 0;
        if (total > 0 && done >= total) return 150;
        return 300;
      },
    }
  );
  const didRefetchAt100Ref = useRef(false);
  useEffect(() => {
    if (!data?.building) {
      didRefetchAt100Ref.current = false;
      return;
    }
    const total = data.totalFiles ?? 0;
    const done = data.filesProcessed ?? 0;
    if (total > 0 && done >= total) {
      if (didRefetchAt100Ref.current) return;
      didRefetchAt100Ref.current = true;
      const t1 = setTimeout(() => refetch(), 100);
      const t2 = setTimeout(() => refetch(), 350);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
    if (total === 0 && done === 0) {
      refetch();
    }
    didRefetchAt100Ref.current = false;
  }, [data?.building, data?.filesProcessed, data?.totalFiles, refetch]);

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

  const nodePaths = useMemo(() => nodes.map((n) => n.path), [nodes]);
  const fileTreeRoot = useMemo(() => buildFileTree(nodePaths), [nodePaths]);
  const nodePathSet = useMemo(() => new Set(nodePaths.map(normalizePathForCompare)), [nodePaths]);

  useEffect(() => {
    const entries = [...fileTreeRoot.entries()];
    const firstLevelFolders = entries.filter(([, node]) => node.type === 'folder').map(([name]) => name);
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      firstLevelFolders.forEach((f) => next.add(f));
      return next;
    });
  }, [fileTreeRoot]);

  const { outbound, inbound } = useMemo(() => {
    if (!selectedPath) return { outbound: [], inbound: [] };
    const norm = normalizePathForCompare(selectedPath);
    const outboundEdges = edges.filter((e) => normalizePathForCompare(e.source) === norm);
    const inboundEdges = edges.filter((e) => normalizePathForCompare(e.target) === norm);
    return {
      outbound: outboundEdges.map((e) => ({ path: e.target, type: e.type })),
      inbound: inboundEdges.map((e) => ({ path: e.source, type: e.type })),
    };
  }, [selectedPath, edges]);

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  };

  const renderFileTreeNode = (node: FileTreeNode, prefixPath: string, depth: number): React.ReactNode => {
    const pathKey = prefixPath ? `${prefixPath}/${node.name}` : node.name;
    if (node.type === 'folder') {
      const expanded = expandedFolders.has(pathKey);
      const entries = sortFileTreeEntries([...node.children.entries()]);
      return (
        <Box key={pathKey}>
          <UnstyledButton
            onClick={() => toggleFolder(pathKey)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 6px',
              paddingLeft: 6 + depth * 14,
              width: '100%',
              textAlign: 'left',
              borderRadius: 4,
              fontSize: 'var(--mantine-font-size-sm)',
            }}
          >
            {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
            <Text size="sm" component="span">{node.name}</Text>
          </UnstyledButton>
          {expanded && entries.map(([key, child]) => renderFileTreeNode(child, pathKey, depth + 1))}
        </Box>
      );
    }
    const isSelected = selectedPath !== null && normalizePathForCompare(node.path) === normalizePathForCompare(selectedPath);
    return (
      <UnstyledButton
        key={node.path}
        onClick={() => setSelectedPath(node.path)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '2px 6px',
          paddingLeft: 6 + depth * 14,
          width: '100%',
          textAlign: 'left',
          borderRadius: 4,
          fontSize: 'var(--mantine-font-size-sm)',
          backgroundColor: isSelected ? 'var(--app-accent-bg)' : 'transparent',
        }}
      >
        <IconFile size={14} style={{ flexShrink: 0 }} />
        <Text size="sm" component="span" style={{ wordBreak: 'break-all' }}>{node.name}</Text>
      </UnstyledButton>
    );
  };

  const fileTreeEntries = useMemo(() => sortFileTreeEntries([...fileTreeRoot.entries()]), [fileTreeRoot]);

  return (
    <Stack p="md" gap="md" style={{ height: '100%', minHeight: 0, boxSizing: 'border-box' }}>
      <Group justify="space-between" wrap="nowrap">
        <Title order={3}>Code explorer</Title>
        <Group wrap="nowrap" gap="xs">
          <TextInput
            placeholder="Path (default: root)"
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

      {!building && (nodes.length > 0 || edges.length > 0) && (
        <Tabs defaultValue="graph" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Tabs.List>
            <Tabs.Tab value="graph">Graph</Tabs.Tab>
            <Tabs.Tab value="file-tree">File tree</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="graph" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} pt="sm">
            {(isLoading && !data) ? (
              <Text size="sm" c="dimmed">Loading…</Text>
            ) : (
              <Card withBorder padding={0} style={{ ...CARD_STYLE, flex: 1, minHeight: 400, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <Box p="xs" style={{ borderBottom: '1px solid var(--app-border)' }}>
                  <Text size="xs" c="dimmed">D3 force-directed · {nodes.length} nodes · {edges.length} links</Text>
                </Box>
                <Box style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                  <DependencyGraphForceChart nodes={nodes} edges={edges} pathStripPrefix={data?.pathStripPrefix ?? ''} />
                </Box>
              </Card>
            )}
          </Tabs.Panel>
          <Tabs.Panel value="file-tree" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} pt="sm">
            <Box style={{ flex: 1, minHeight: 0, display: 'flex', gap: 16, overflow: 'hidden' }}>
              <Card withBorder padding="xs" style={{ ...CARD_STYLE, flex: '0 0 280px', minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <Text size="xs" c="dimmed" mb="xs" px="xs">Files in graph</Text>
                <ScrollArea style={{ flex: 1 }} type="auto">
                  {fileTreeEntries.map(([key, node]) => renderFileTreeNode(node, '', 0))}
                </ScrollArea>
              </Card>
              <Card withBorder padding="md" style={{ ...CARD_STYLE, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {selectedPath ? (
                  nodePathSet.has(normalizePathForCompare(selectedPath)) ? (
                    <Stack gap="md">
                      <Text size="sm" fw={600} style={{ fontFamily: 'var(--mono-font)', wordBreak: 'break-all' }}>{selectedPath}</Text>
                      <Box>
                        <Text size="xs" fw={600} c="dimmed" mb="xs">Depends on</Text>
                        {outbound.length > 0 ? (
                          <List size="sm" spacing="xs">
                            {outbound.map(({ path: targetPath, type }, i) => (
                              <List.Item key={`${targetPath}-${i}`}>
                                <Text size="sm" component="span" style={{ fontFamily: 'var(--mono-font)', wordBreak: 'break-all' }}>{targetPath}</Text>
                                <Text size="xs" c="dimmed" component="span" ml="xs">({type})</Text>
                              </List.Item>
                            ))}
                          </List>
                        ) : (
                          <Text size="sm" c="dimmed">No direct dependencies.</Text>
                        )}
                      </Box>
                      <Box>
                        <Text size="xs" fw={600} c="dimmed" mb="xs">Depended on by</Text>
                        {inbound.length > 0 ? (
                          <List size="sm" spacing="xs">
                            {inbound.map(({ path: sourcePath, type }, i) => (
                              <List.Item key={`${sourcePath}-${i}`}>
                                <Text size="sm" component="span" style={{ fontFamily: 'var(--mono-font)', wordBreak: 'break-all' }}>{sourcePath}</Text>
                                <Text size="xs" c="dimmed" component="span" ml="xs">({type})</Text>
                              </List.Item>
                            ))}
                          </List>
                        ) : (
                          <Text size="sm" c="dimmed">Nothing depends on this file.</Text>
                        )}
                      </Box>
                    </Stack>
                  ) : (
                    <Text size="sm" c="dimmed">Selected file is not in the dependency graph.</Text>
                  )
                ) : (
                  <Text size="sm" c="dimmed">Select a file from the tree to see what it depends on and what depends on it.</Text>
                )}
              </Card>
            </Box>
          </Tabs.Panel>
        </Tabs>
      )}

      {!building && (isLoading && !data) && (
        <Text size="sm" c="dimmed">Loading…</Text>
      )}

      {!building && !(isLoading && !data) && nodes.length === 0 && edges.length === 0 && (
        <Text size="sm" c="dimmed">No files or dependencies in this path. Try a different path (e.g. src or .).</Text>
      )}
    </Stack>
  );
}

export default CodeExplorerPage;
