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
import { Box, Text, ScrollArea, Title } from '@mantine/core';
import { GitDiffFile, GitDiffHunk, GitDiffLine } from '../../shared/types';
import { DiffLine } from './DiffLine';

interface HunkViewerProps {
  diffFiles: GitDiffFile[];
  activeFile: string;
}

export function HunkViewer({ diffFiles, activeFile }: HunkViewerProps) {
  const file = diffFiles.find(f => f.path === activeFile);
  
  if (!file) {
    return <Text>No file found</Text>;
  }

  return (
    <Box style={{ padding: '20px', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <Title order={4} style={{ marginBottom: '15px' }}>
        {file.path} ({file.status})
      </Title>
      
      <ScrollArea style={{ flex: 1 }}>
        {file.hunks.map((hunk, hunkIndex) => (
          <Box key={hunkIndex} style={{ marginBottom: '20px' }}>
            <Text 
              style={{ 
                fontSize: '12px', 
                color: '#666', 
                backgroundColor: '#f8f9fa', 
                padding: '5px 10px', 
                borderRadius: '4px', 
                marginBottom: '10px',
                fontFamily: 'monospace'
              }}
            >
              {hunk.header}
            </Text>
            
            {hunk.lines.map((line, lineIndex) => (
              <DiffLine key={lineIndex} line={line} />
            ))}
          </Box>
        ))}
      </ScrollArea>
    </Box>
  );
}