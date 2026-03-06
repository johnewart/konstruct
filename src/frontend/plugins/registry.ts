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
 * Plugin views are loaded by convention: for each enabled plugin id, the app
 * imports `konstruct-plugin-<id>/view`. That module must export `path`, `label`,
 * and a default React component. No registry entry needed.
 */

/** Props passed to plugin settings panels (see konstruct-sdk PluginSettingsProps). */
export interface PluginSettingsProps {
  pluginId: string;
  projectId: string;
  /** Per-workspace settings blob (less common — prefer pluginConfig for credentials). */
  settings: Record<string, unknown>;
  /** Global plugin config blob (credentials, endpoints, etc.). */
  pluginConfig: Record<string, unknown>;
  /** Save per-workspace settings. */
  onSave: (settings: Record<string, unknown>) => void;
  /** Save global plugin config (credentials, endpoints). This is what the backend reads. */
  onSaveConfig: (config: Record<string, unknown>) => void;
}

/**
 * Auto-discovered settings panels for all plugins.
 * Vite evaluates this glob at build time — any new `packages/konstruct-plugin-X/settings.mjs`
 * is picked up automatically without any manual registry entry.
 */
const settingsModules = import.meta.glob<{ default: ComponentType<PluginSettingsProps> }>(
  '../../../packages/konstruct-plugin-*/settings.mjs'
);

/**
 * Returns the settings panel loader for a given plugin id, or null if the
 * plugin has no settings panel.
 */
export function getPluginSettingsLoader(
  pluginId: string
): (() => Promise<{ default: ComponentType<PluginSettingsProps> }>) | null {
  const key = `../../../packages/konstruct-plugin-${pluginId}/settings.mjs`;
  return settingsModules[key] ?? null;
}
