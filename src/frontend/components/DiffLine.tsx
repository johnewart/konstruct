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
import { GitDiffLine } from '../../shared/types';

interface DiffLineProps {
  line: GitDiffLine;
}

export function DiffLine({ line }: DiffLineProps) {
  let bgColor = 'transparent';
  let borderLeft = '2px solid transparent';

  switch (line.type) {
    case 'add':
      bgColor = 'var(--app-success-bg)';
      borderLeft = '2px solid var(--app-success-border)';
      break;
    case 'remove':
      bgColor = 'var(--app-danger-bg)';
      borderLeft = '2px solid var(--app-danger-text)';
      break;
    case 'context':
      bgColor = 'var(--app-hover)';
      borderLeft = '2px solid var(--app-context-border)';
      break;
  }

  return (
    <Box
      style={{
        display: 'flex',
        backgroundColor: bgColor,
        borderLeft,
        padding: '3px 10px',
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      }}
    >
      <Text style={{ color: 'var(--app-text-muted)', minWidth: '44px', marginRight: '12px', flexShrink: 0 }}>
        {line.lineNumber}
      </Text>
      <Text component="span" style={{ fontFamily: 'inherit', fontSize: 'inherit' }}>
        {line.content}
      </Text>
    </Box>
  );
}