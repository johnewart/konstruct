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

import { z } from 'zod';
import { router, publicProcedure } from '../trpc/trpc';
import { loadGlobalConfig, saveGlobalConfig } from '../../shared/config';
import { getLoadedPluginIds, listAvailablePlugins, unloadPlugin } from '../plugins/registry';

export const pluginsRouter = router({
  /** List enabled plugin ids (from config) that were successfully loaded. */
  listEnabled: publicProcedure.query(() => {
    const config = loadGlobalConfig();
    const enabled = config.plugins?.enabled ?? [];
    const loaded = getLoadedPluginIds();
    const plugins = enabled.filter((id) => loaded.includes(id)).map((id) => ({ id }));
    return { plugins };
  }),

  /** List installed konstruct-plugin-* packages (id, name, description). */
  listAvailable: publicProcedure.query(() => {
    const available = listAvailablePlugins();
    const config = loadGlobalConfig();
    const enabled = new Set(config.plugins?.enabled ?? []);
    const loaded = new Set(getLoadedPluginIds());
    return {
      plugins: available.map((p) => ({
        ...p,
        enabled: enabled.has(p.id),
        loaded: loaded.has(p.id),
      })),
    };
  }),

  /** True when any enabled plugin is not yet loaded (restart required to load it). */
  getRestartNeeded: publicProcedure.query(() => {
    const config = loadGlobalConfig();
    const enabled = new Set(config.plugins?.enabled ?? []);
    const loaded = new Set(getLoadedPluginIds());
    const restartNeeded = [...enabled].some((id) => !loaded.has(id));
    return { restartNeeded };
  }),

  /** Exit the server process so it can be restarted (e.g. by process manager or user). */
  restartServer: publicProcedure.mutation(() => {
    setTimeout(() => process.exit(0), 800);
    return { ok: true };
  }),

  /** Enable or disable a plugin (persists to config; disabling unloads tools immediately; re-enable requires restart). */
  setPluginEnabled: publicProcedure
    .input(z.object({ pluginId: z.string().min(1), enabled: z.boolean() }))
    .mutation(({ input }) => {
      const config = loadGlobalConfig();
      const list = [...(config.plugins?.enabled ?? [])];
      const idx = list.indexOf(input.pluginId);
      if (input.enabled && idx === -1) list.push(input.pluginId);
      if (!input.enabled && idx !== -1) {
        list.splice(idx, 1);
        unloadPlugin(input.pluginId);
      }
      config.plugins = list.length ? { enabled: list } : undefined;
      saveGlobalConfig(config);
      return { ok: true };
    }),

  /** Get per-workspace settings for a plugin. */
  getPluginSettings: publicProcedure
    .input(z.object({ projectId: z.string().min(1), pluginId: z.string().min(1) }))
    .query(({ input }) => {
      const config = loadGlobalConfig();
      const settings = config.pluginSettings?.[input.projectId]?.[input.pluginId];
      return { settings: settings ?? {} };
    }),

  /** Set per-workspace settings for a plugin. */
  setPluginSettings: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        pluginId: z.string().min(1),
        settings: z.record(z.string(), z.unknown()),
      })
    )
    .mutation(({ input }) => {
      const config = loadGlobalConfig();
      config.pluginSettings = config.pluginSettings ?? {};
      if (!config.pluginSettings[input.projectId]) config.pluginSettings[input.projectId] = {};
      config.pluginSettings[input.projectId][input.pluginId] = input.settings;
      saveGlobalConfig(config);
      return { ok: true };
    }),

  /** Get global config blob for a plugin (credentials, endpoints — not per-workspace). */
  getPluginConfig: publicProcedure
    .input(z.object({ pluginId: z.string().min(1) }))
    .query(({ input }) => {
      const config = loadGlobalConfig();
      const blob = config.pluginConfig?.[input.pluginId];
      return { config: blob ?? {} };
    }),

  /** Save global config blob for a plugin (credentials, endpoints — not per-workspace). */
  setPluginConfig: publicProcedure
    .input(
      z.object({
        pluginId: z.string().min(1),
        config: z.record(z.string(), z.unknown()),
      })
    )
    .mutation(({ input }) => {
      const cfg = loadGlobalConfig();
      cfg.pluginConfig = cfg.pluginConfig ?? {};
      cfg.pluginConfig[input.pluginId] = input.config;
      saveGlobalConfig(cfg);
      return { ok: true };
    }),
});
