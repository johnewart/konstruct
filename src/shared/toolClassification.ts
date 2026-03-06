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

/**
 * Tools are split into two classes for routing:
 * - Backend: run in the Konstruct server (session store, progress, external APIs like GitHub/Jira).
 * - Agent: run in the workspace agent process (files, git, terminal, dependency graph).
 *
 * The MCP server runs in the backend and routes each tool call to either backend execution
 * or the agent process for the project.
 */

/** Tool names that run in the backend (session, progress, external APIs). Everything else runs in the agent. */
export const BACKEND_TOOL_NAMES = new Set<string>([
  'set_status',
  'list_todos',
  'add_todo',
  'update_todo',
  'update_session_title',
  'suggest_relevant_file',
  'suggest_improvement',
]);

/** Dynamically register a tool name as a backend tool (e.g. from a plugin). */
export function addBackendToolName(name: string): void {
  BACKEND_TOOL_NAMES.add(name);
}

export function isBackendTool(name: string): boolean {
  return BACKEND_TOOL_NAMES.has(name);
}

export function isAgentTool(name: string): boolean {
  return !BACKEND_TOOL_NAMES.has(name);
}
