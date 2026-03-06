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
  settings: Record<string, unknown>;
  onSave: (settings: Record<string, unknown>) => void;
}

/**
 * Load settings by convention: konstruct-plugin-<id>/settings (default export).
 * No registry entry needed. If the plugin has no ./settings module, the import will fail.
 */
export function getPluginSettingsLoader(
  pluginId: string
): () => Promise<{ default: ComponentType<PluginSettingsProps> }> {
  return () => import(/* @vite-ignore */ `konstruct-plugin-${pluginId}/settings`);
}
