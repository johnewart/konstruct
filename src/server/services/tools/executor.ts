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

import path from 'path';
import type { ChatMessage } from '../sessionStore';

export interface ToolResult {
  result?: string;
  error?: string;
  retryable?: boolean;
}

const projectRoot = process.env.PROJECT_ROOT ?? process.cwd();

export function resolvePath(
  relativePath: string
): { fullPath: string } | { error: string } {
  const fullPath = path.join(projectRoot, relativePath);
  const absPath = path.resolve(fullPath);
  const absRoot = path.resolve(projectRoot);
  const sep = path.sep;
  if (absRoot && absPath !== absRoot && !absPath.startsWith(absRoot + sep)) {
    return { error: 'path outside project root' };
  }
  return { fullPath: absPath };
}

export interface ToolContext {
  sessionId?: string;
}

type Runner = (
  args: Record<string, unknown>,
  context?: ToolContext
) => Promise<ToolResult> | ToolResult;

const runners: Record<string, Runner> = {};

export function registerTool(name: string, fn: Runner) {
  runners[name] = fn;
}

export function executeTool(
  name: string,
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<ToolResult> {
  const fn = runners[name];
  if (!fn) {
    return Promise.resolve({ error: `unknown tool: ${name}` });
  }
  return Promise.resolve(fn(args, context));
}

export function getProjectRoot(): string {
  return projectRoot;
}
