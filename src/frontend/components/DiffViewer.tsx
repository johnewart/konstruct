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
import { Box, Tabs, ScrollArea, Group, Text } from '@mantine/core';
import { GitDiffFile } from '../../shared/types';
import { ChangedFilesList } from './ChangedFilesList';
import { HunkViewer } from './HunkViewer';

interface DiffViewerProps {
  diffFiles: GitDiffFile[];
  activeFile: string | null;
  onFileSelect: (file: string) => void;
}

export function DiffViewer({ diffFiles, activeFile, onFileSelect }: DiffViewerProps) {
  return (
    <Box style={{ display: 'flex', height: 'calc(100vh - 100px)' }}>
      <Box style={{ width: '300px', borderRight: '1px solid #e0e0e0', overflowY: 'auto' }}>
        <ChangedFilesList 
          diffFiles={diffFiles} 
          activeFile={activeFile} 
          onFileSelect={onFileSelect} 
        />
      </Box>
      <Box style={{ flex: 1, overflow: 'hidden' }}>
        {activeFile ? (
          <HunkViewer 
            diffFiles={diffFiles} 
            activeFile={activeFile} 
          />
        ) : (
          <Box style={{ 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center', 
            height: '100%', 
            color: '#666' 
          }}>
            <Text>Select a file to view changes</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}