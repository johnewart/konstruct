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
import { Box, Text } from '@mantine/core';
import { GitDiffFile } from '../../shared/types';
import './DiffViewer.css';
import { ChangedFilesList } from './ChangedFilesList';
import { HunkViewer } from './HunkViewer';
import type { DiffComment } from '../../shared/types';

interface DiffViewerProps {
  diffFiles: GitDiffFile[];
  activeFile: string | null;
  onFileSelect: (file: string) => void;
  sessionId: string | null;
  comments: DiffComment[];
  onCommentAdded: () => void;
}

export function DiffViewer({
  diffFiles,
  activeFile,
  onFileSelect,
  sessionId,
  comments,
  onCommentAdded,
}: DiffViewerProps) {
  return (
    <Box className="diff-viewer-code-review" style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <Box style={{ width: '420px', minWidth: '320px', borderRight: '1px solid var(--app-border)', overflowY: 'auto' }}>
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
            sessionId={sessionId}
            comments={comments}
            onCommentAdded={onCommentAdded}
          />
        ) : (
          <Box
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              height: '100%',
              color: 'var(--app-text-muted)',
            }}
          >
            <Text>Select a file to view changes</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}