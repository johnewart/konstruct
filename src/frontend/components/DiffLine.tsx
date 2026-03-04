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
import { Box, Text, Group } from '@mantine/core';
import { GitDiffLine } from '../../shared/types';

interface DiffLineProps {
  line: GitDiffLine;
}

export function DiffLine({ line }: DiffLineProps) {
  let bgColor = 'transparent';
  let borderLeft = '2px solid transparent';
  
  switch (line.type) {
    case 'add':
      bgColor = '#d4edda';
      borderLeft = '2px solid #28a745';
      break;
    case 'remove':
      bgColor = '#f8d7da';
      borderLeft = '2px solid #dc3545';
      break;
    case 'context':
      bgColor = '#f8f9fa';
      borderLeft = '2px solid #6c757d';
      break;
  }

  return (
    <Box
      style={{
        display: 'flex',
        backgroundColor: bgColor,
        borderLeft: borderLeft,
        padding: '4px 8px',
        fontFamily: 'monospace',
        fontSize: '12px',
        lineHeight: '1.4',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      }}
    >
      <Text style={{ color: '#666', minWidth: '50px', marginRight: '10px' }}>
        {line.lineNumber}
      </Text>
      <Text>
        {line.content}
      </Text>
    </Box>
  );
}