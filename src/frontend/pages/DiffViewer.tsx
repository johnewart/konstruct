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

import React, { useState } from 'react';
import { Box, Loader, Text, Group, Title } from '@mantine/core';
import { trpc } from '../../client/trpc';
import { DiffViewer } from '../components/DiffViewer';

export function DiffViewerPage() {
  const [activeFile, setActiveFile] = useState<string | null>(null);
  
  const { data: diffFiles, isLoading, error } = trpc.git.getGitDiff.useQuery();

  if (isLoading) {
    return (
      <Box style={{ textAlign: 'center', padding: '40px' }}>
        <Loader size="lg" />
        <Text mt="sm">Loading git changes...</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box style={{ textAlign: 'center', padding: '40px' }}>
        <Text color="red">Error loading git changes: {error.message}</Text>
      </Box>
    );
  }

  if (!diffFiles || diffFiles.length === 0) {
    return (
      <Box style={{ textAlign: 'center', padding: '40px' }}>
        <Title order={3}>No changes detected</Title>
        <Text mt="sm">There are no modified, added, or deleted files in the repository.</Text>
      </Box>
    );
  }

  return (
    <Box style={{ padding: '20px' }}>
      <Title order={2}>Git Changes</Title>
      <DiffViewer 
        diffFiles={diffFiles} 
        activeFile={activeFile} 
        onFileSelect={setActiveFile} 
      />
    </Box>
  );
}

export default DiffViewerPage;