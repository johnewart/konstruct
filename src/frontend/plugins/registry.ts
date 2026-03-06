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
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { ComponentType } from 'react';

export interface PluginViewMeta {
  path: string;
  label: string;
  Component: ComponentType;
}

/**
 * Map plugin id -> dynamic import of the plugin's view entry.
 * Add an entry when adding a plugin dependency, e.g.:
 *   jira: () => import('konstruct-plugin-jira/view'),
 */
export const PLUGIN_VIEW_IMPORTERS: Record<
  string,
  () => Promise<{ path: string; label: string; default: ComponentType }>
> = {
  // Example when konstruct-plugin-jira is installed:
  // jira: () => import('konstruct-plugin-jira/view'),
};

/** Props passed to plugin settings panels (see konstruct-sdk PluginSettingsProps). */
export interface PluginSettingsProps {
  pluginId: string;
  projectId: string;
  settings: Record<string, unknown>;
  onSave: (settings: Record<string, unknown>) => void;
}

/**
 * Map plugin id -> dynamic import of the plugin's settings component (default export).
 * Add an entry when a plugin provides ./settings, e.g.:
 *   jira: () => import('konstruct-plugin-jira/settings'),
 */
export const PLUGIN_SETTINGS_IMPORTERS: Record<
  string,
  () => Promise<{ default: ComponentType<PluginSettingsProps> }>
> = {
  example: () => import('konstruct-plugin-example/settings'),
};
