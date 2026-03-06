/*
 * Copyright 2026 John Ewart <john@johnewart.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use it except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS FOR ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Konstruct Plugin SDK – types and contract for plugins.
 *
 * Plugins are npm packages named `konstruct-plugin-<id>`. They export a
 * `register(api)` function and may optionally export a settings panel and/or
 * a view for the sidebar.
 */

/** Tool definition shape passed to the model (function name, description, parameters). */
export type ToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/** Result returned by a tool runner. */
export interface ToolResult {
  result?: string;
  error?: string;
  retryable?: boolean;
}

/** Context passed to tool runners (project root, session, etc.). */
export interface ToolContext {
  sessionId?: string;
  projectRoot?: string;
}

/** A tool runner function registered with registerTool. */
export type ToolRunner = (
  args: Record<string, unknown>,
  context?: ToolContext
) => Promise<ToolResult> | ToolResult;

/** Minimal config shape visible to plugins (full config may have more). */
export interface KonstructPluginConfig {
  plugins?: { enabled?: string[] };
  [key: string]: unknown;
}

/** API passed to plugin register(api). The host implements this. */
export interface KonstructPluginApi {
  registerTool: (name: string, fn: ToolRunner) => void;
  addToolDefinitions: (defs: ToolDefinition[]) => void;
  config: KonstructPluginConfig;
  pluginConfig: Record<string, unknown>;
  registerRouter: (name: string, router: unknown) => void;
}

/** Props for the optional settings panel component (export default from ./settings). */
export interface PluginSettingsProps {
  pluginId: string;
  projectId: string;
  settings: Record<string, unknown>;
  onSave: (settings: Record<string, unknown>) => void;
}
