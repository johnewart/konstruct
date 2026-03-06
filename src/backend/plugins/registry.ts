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

import { createRequire } from 'node:module';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import type { KonstructPluginApi } from 'konstruct-sdk';
import type { KonstructConfig } from '../../shared/config';
import type { ToolDefinition } from '../../shared/llm';
import { registerTool, unregisterTools } from '../../agent/tools/executor';
import { loadGlobalConfig } from '../../shared/config';
import { createLogger } from '../../shared/logger';

// Ensure core tools are registered before plugins load
import '../../agent/tools/runners';

const log = createLogger('plugins');

const require = createRequire(import.meta.url);

const pluginToolDefs: ToolDefinition[] = [];
const pluginRouters: Record<string, unknown> = {};
const loadedIds: string[] = [];
/** Plugin id -> tool names registered by that plugin (for unload). */
const pluginIdToToolNames: Record<string, string[]> = {};
let loaded = false;

/**
 * Load all enabled plugins from config. Resolves konstruct-plugin-<id> from node_modules,
 * calls register(api), and collects tool definitions and routers.
 * Must be called before getToolsForMode or app router is used.
 */
export function loadPlugins(config: KonstructConfig): void {
  if (loaded) return;
  loaded = true;
  const enabled = config.plugins?.enabled ?? [];
  if (enabled.length === 0) return;

  for (const id of enabled) {
    const packageName = `konstruct-plugin-${id}`;
    try {
      const resolved = require.resolve(packageName);
      const mod = require(resolved);
      const register = mod?.register ?? mod?.default;
      if (typeof register !== 'function') {
        log.warn(`Plugin ${packageName} has no register function, skipping`);
        continue;
      }
      pluginIdToToolNames[id] = [];
      const pluginConfig = (config[id as keyof KonstructConfig] as Record<string, unknown>) ?? {};
      const api: KonstructPluginApi = {
        registerTool(name: string, fn: Parameters<typeof registerTool>[1]) {
          pluginIdToToolNames[id].push(name);
          registerTool(name, fn);
        },
        addToolDefinitions(defs: ToolDefinition[]) {
          for (const d of defs) if (d?.function?.name) pluginIdToToolNames[id].push(d.function.name);
          pluginToolDefs.push(...defs);
        },
        config,
        pluginConfig,
        registerRouter(name: string, router: unknown) {
          pluginRouters[name] = router;
        },
      };
      register(api);
      loadedIds.push(id);
      log.debug('Loaded plugin', id);
    } catch (err) {
      log.warn(`Failed to load plugin ${packageName}:`, err);
    }
  }
}

/**
 * Unload a plugin: remove its tools from the executor and from plugin tool definitions.
 * Call when a plugin is disabled. Re-enabling requires a server restart.
 */
export function unloadPlugin(pluginId: string): void {
  const names = pluginIdToToolNames[pluginId];
  if (!names?.length) {
    if (loadedIds.includes(pluginId)) {
      loadedIds.splice(loadedIds.indexOf(pluginId), 1);
    }
    delete pluginIdToToolNames[pluginId];
    return;
  }
  unregisterTools(names);
  const nameSet = new Set(names);
  for (let i = pluginToolDefs.length - 1; i >= 0; i--) {
    if (nameSet.has(pluginToolDefs[i].function?.name)) pluginToolDefs.splice(i, 1);
  }
  const idx = loadedIds.indexOf(pluginId);
  if (idx !== -1) loadedIds.splice(idx, 1);
  delete pluginIdToToolNames[pluginId];
  log.debug('Unloaded plugin', pluginId);
}

export function getPluginToolDefinitions(): ToolDefinition[] {
  return [...pluginToolDefs];
}

export function getPluginRouters(): Record<string, unknown> {
  return { ...pluginRouters };
}

export function getLoadedPluginIds(): string[] {
  return [...loadedIds];
}

const PLUGIN_PREFIX = 'konstruct-plugin-';

/** Discover installed konstruct-plugin-* packages from app package.json. */
export function listAvailablePlugins(): Array<{ id: string; name: string; description: string }> {
  const cwd = process.cwd();
  const pkgPath = path.join(cwd, 'package.json');
  if (!existsSync(pkgPath)) return [];
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as typeof pkg;
  } catch {
    return [];
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const ids = Object.keys(deps).filter((k) => k.startsWith(PLUGIN_PREFIX)).map((k) => k.slice(PLUGIN_PREFIX.length));
  const result: Array<{ id: string; name: string; description: string }> = [];
  for (const id of ids) {
    const packageName = PLUGIN_PREFIX + id;
    try {
      const resolved = require.resolve(packageName);
      let dir = path.dirname(resolved);
      while (dir !== path.dirname(dir)) {
        const pluginPkgPath = path.join(dir, 'package.json');
        if (existsSync(pluginPkgPath)) break;
        dir = path.dirname(dir);
      }
      const pluginPkgPath = path.join(dir, 'package.json');
      const pluginPkg = existsSync(pluginPkgPath)
        ? (JSON.parse(readFileSync(pluginPkgPath, 'utf-8')) as { name?: string; description?: string })
        : {};
      result.push({
        id,
        name: pluginPkg.name ?? packageName,
        description: typeof pluginPkg.description === 'string' ? pluginPkg.description : '',
      });
    } catch {
      result.push({ id, name: packageName, description: '' });
    }
  }
  result.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}

// Load plugins when registry is first imported (e.g. when router is built)
loadPlugins(loadGlobalConfig());
