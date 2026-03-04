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
import { Box, Text, Group, UnstyledButton } from '@mantine/core';
import { GitDiffFile } from '../../shared/types';

interface ChangedFilesListProps {
  diffFiles: GitDiffFile[];
  activeFile: string | null;
  onFileSelect: (file: string) => void;
}

export function ChangedFilesList({ diffFiles, activeFile, onFileSelect }: ChangedFilesListProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'A': return '#28a745'; // Green for added
      case 'D': return '#dc3545'; // Red for deleted
      case 'M': return '#007bff'; // Blue for modified
      case 'R': return '#6f42c1'; // Purple for renamed
      case 'C': return '#fd7e14'; // Orange for copied
      default: return '#6c757d'; // Gray for unknown
    }
  };

  return (
    <Box style={{ padding: '10px' }}>
      <Text weight={500} size="sm" style={{ marginBottom: '10px' }}>
        Changed Files ({diffFiles.length})
      </Text>
      
      {diffFiles.map((file) => (
        <UnstyledButton
          key={file.path}
          onClick={() => onFileSelect(file.path)}
          style={{
            width: '100%',
            textAlign: 'left',
            padding: '8px 12px',
            borderRadius: '4px',
            marginBottom: '4px',
            backgroundColor: activeFile === file.path ? '#e9ecef' : 'transparent',
            border: activeFile === file.path ? '1px solid #007bff' : 'none',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            '&:hover': {
              backgroundColor: '#f8f9fa',
            },
          }}
        >
          <Group position="apart" noWrap>
            <Text size="sm" style={{ wordBreak: 'break-all', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {file.path}
            </Text>
            <Box
              style={{
                backgroundColor: getStatusColor(file.status),
                color: 'white',
                borderRadius: '10px',
                padding: '2px 6px',
                fontSize: '10px',
                fontWeight: 'bold',
              }}
            >
              {file.status}
            </Box>
          </Group>
        </UnstyledButton>
      ))}
    </Box>
  );
}