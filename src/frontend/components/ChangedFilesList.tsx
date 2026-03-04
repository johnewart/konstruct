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

import React, { useMemo, useState, useEffect } from 'react';
import { Box, Text, UnstyledButton, Collapse } from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconFile, IconFolder, IconFolderOpen } from '@tabler/icons-react';
import { GitDiffFile } from '../../shared/types';

interface ChangedFilesListProps {
  diffFiles: GitDiffFile[];
  activeFile: string | null;
  onFileSelect: (file: string) => void;
}

type TreeNode =
  | { type: 'folder'; name: string; children: Map<string, TreeNode> }
  | { type: 'file'; name: string; file: GitDiffFile };

function buildTree(diffFiles: GitDiffFile[]): Map<string, TreeNode> {
  const root = new Map<string, TreeNode>();
  for (const file of diffFiles) {
    const parts = file.path.split('/');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      if (isLast) {
        current.set(part, { type: 'file', name: part, file });
      } else {
        let node = current.get(part);
        if (!node || node.type === 'file') {
          node = { type: 'folder', name: part, children: new Map() };
          current.set(part, node);
        }
        current = (node as { type: 'folder'; children: Map<string, TreeNode> }).children;
      }
    }
  }
  return root;
}

function sortTreeEntries(entries: [string, TreeNode][]): [string, TreeNode][] {
  return [...entries].sort(([a, aNode], [b, bNode]) => {
    const aIsFolder = aNode.type === 'folder';
    const bIsFolder = bNode.type === 'folder';
    if (aIsFolder && !bIsFolder) return -1;
    if (!aIsFolder && bIsFolder) return 1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
}

const statusColors: Record<string, string> = {
  A: '#28a745',
  D: '#dc3545',
  M: '#007bff',
  R: '#6f42c1',
  C: '#fd7e14',
  '??': '#6c757d',
};

export function ChangedFilesList({ diffFiles, activeFile, onFileSelect }: ChangedFilesListProps) {
  const tree = useMemo(() => buildTree(diffFiles), [diffFiles]);

  const allFolderPaths = useMemo(() => {
    const paths = new Set<string>();
    function walk(n: TreeNode, path: string) {
      if (n.type === 'folder') {
        paths.add(path);
        n.children.forEach((child, key) => walk(child, path + '/' + key));
      }
    }
    tree.forEach((node, key) => walk(node, key));
    return paths;
  }, [tree]);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(allFolderPaths));
  useEffect(() => {
    setExpanded(new Set(allFolderPaths));
  }, [allFolderPaths]);

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderNode = (node: TreeNode, path: string, depth: number): React.ReactNode => {
    if (node.type === 'file') {
      const isActive = activeFile === node.file.path;
      const statusColor = statusColors[node.file.status] ?? '#6c757d';
      return (
        <UnstyledButton
          key={node.file.path}
          onClick={() => onFileSelect(node.file.path)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            width: '100%',
            textAlign: 'left',
            padding: '3px 8px',
            paddingLeft: 8 + depth * 14,
            borderRadius: 4,
            backgroundColor: isActive ? 'var(--app-accent-bg)' : 'transparent',
            border: isActive ? '1px solid var(--app-accent)' : 'none',
            cursor: 'pointer',
            transition: 'background-color 0.15s ease',
            fontSize: 14,
          }}
          onMouseEnter={(e) => {
            if (!isActive) e.currentTarget.style.backgroundColor = 'var(--app-hover)';
          }}
          onMouseLeave={(e) => {
            if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          <IconFile size={14} style={{ flexShrink: 0, color: 'var(--app-text-muted)' }} />
          <Text size="sm" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 'inherit' }}>
            {node.name}
          </Text>
          <Box
            style={{
              backgroundColor: statusColor,
              color: 'white',
              borderRadius: 6,
              padding: '1px 4px',
              fontSize: 10,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {node.file.status}
          </Box>
        </UnstyledButton>
      );
    }
    const children = sortTreeEntries([...node.children.entries()]);
    const isExpanded = expanded.has(path);
    return (
      <Box key={path}>
        <UnstyledButton
          onClick={() => toggle(path)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            width: '100%',
            textAlign: 'left',
            padding: '3px 8px',
            paddingLeft: 8 + depth * 14,
            borderRadius: 4,
            cursor: 'pointer',
            transition: 'background-color 0.15s ease',
            fontSize: 14,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--app-hover)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          {isExpanded ? (
            <IconChevronDown size={14} style={{ flexShrink: 0, color: 'var(--app-text-muted)' }} />
          ) : (
            <IconChevronRight size={14} style={{ flexShrink: 0, color: 'var(--app-text-muted)' }} />
          )}
          {isExpanded ? (
            <IconFolderOpen size={14} style={{ flexShrink: 0, color: 'var(--app-text-muted-2)' }} />
          ) : (
            <IconFolder size={14} style={{ flexShrink: 0, color: 'var(--app-text-muted-2)' }} />
          )}
          <Text size="sm" fw={500} style={{ color: 'var(--app-text-muted)', fontSize: 'inherit' }}>
            {node.name}
          </Text>
        </UnstyledButton>
        <Collapse in={isExpanded}>
          {children.map(([key, child]) => renderNode(child, path + '/' + key, depth + 1))}
        </Collapse>
      </Box>
    );
  };

  const rootEntries = sortTreeEntries([...tree.entries()]);

  return (
    <Box style={{ padding: '10px 12px' }}>
      <Text weight={600} size="xs" c="dimmed" style={{ marginBottom: 8, paddingLeft: 4, letterSpacing: '0.02em' }}>
        Changed Files ({diffFiles.length})
      </Text>
      <Box style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rootEntries.map(([key, node]) => renderNode(node, key, 0))}
      </Box>
    </Box>
  );
}
