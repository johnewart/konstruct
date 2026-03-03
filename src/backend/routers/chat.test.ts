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

import { describe, it, expect } from 'vitest';
import { getPlanDisplayLabel, titleCase } from './chat';

describe('titleCase', () => {
  it('should capitalize first letter of each word', () => {
    expect(titleCase('hello world')).toBe('Hello World');
  });

  it('should handle hyphens', () => {
    expect(titleCase('hello-world')).toBe('Hello World');
  });

  it('should handle underscores', () => {
    expect(titleCase('hello_world')).toBe('Hello World');
  });

  it('should handle mixed delimiters', () => {
    expect(titleCase('hello-world_test')).toBe('Hello World Test');
  });

  it('should handle acronyms', () => {
    expect(titleCase('agent_cli')).toBe('Agent CLI');
    expect(titleCase('api_url')).toBe('API URL');
    expect(titleCase('user_id')).toBe('User ID');
  });

  it('should handle single word', () => {
    expect(titleCase('hello')).toBe('Hello');
  });

  it('should handle empty string', () => {
    expect(titleCase('')).toBe('');
  });

  it('should handle acronyms in various cases', () => {
    expect(titleCase('CLI')).toBe('CLI');
    expect(titleCase('API')).toBe('API');
    expect(titleCase('url')).toBe('URL');
  });
});

describe('getPlanDisplayLabel', () => {
  it('should extract H1 header from markdown content', () => {
    const content = `# My Awesome Plan

Some content here.
`;
    expect(getPlanDisplayLabel('test.md', content)).toBe('My Awesome Plan');
  });

  it('should remove Plan: prefix from H1 header', () => {
    const content = `# Plan: Agent CLI Implementation

Some content here.
`;
    expect(getPlanDisplayLabel('test.md', content)).toBe('Agent CLI Implementation');
  });

  it('should remove Plan prefix from H1 header', () => {
    const content = `# Plan: Chat History Fix

Some content here.
`;
    expect(getPlanDisplayLabel('test.md', content)).toBe('Chat History Fix');
  });

  it('should handle H1 with extra whitespace', () => {
    const content = `#   Plan:   Agent CLI  

Some content here.
`;
    expect(getPlanDisplayLabel('test.md', content)).toBe('Agent CLI');
  });

  it('should title-case filename when no H1 header', () => {
    const content = 'No header here';
    expect(getPlanDisplayLabel('agent_cli.md', content)).toBe('Agent CLI');
  });

  it('should handle different file extensions', () => {
    expect(getPlanDisplayLabel('test.markdown', undefined)).toBe('Test');
    expect(getPlanDisplayLabel('test.plan', undefined)).toBe('Test');
    expect(getPlanDisplayLabel('test.konstruct', undefined)).toBe('Test');
  });

  it('should handle filenames with hyphens', () => {
    expect(getPlanDisplayLabel('my-awesome-plan.md', undefined)).toBe('My Awesome Plan');
  });

  it('should handle filenames with underscores', () => {
    expect(getPlanDisplayLabel('my_awesome_plan.md', undefined)).toBe('My Awesome Plan');
  });

  it('should handle filename without extension', () => {
    expect(getPlanDisplayLabel('session_consolidation', undefined)).toBe('Session Consolidation');
  });
});