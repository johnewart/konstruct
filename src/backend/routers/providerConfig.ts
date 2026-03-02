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

import { randomUUID } from 'crypto';
import { z } from 'zod';
import { router, publicProcedure } from '../trpc/trpc';
import {
  loadGlobalConfig,
  saveGlobalConfig,
  loadProjectOnlyConfig,
  saveProjectConfig,
} from '../../shared/config';
import type { ConfigProvider } from '../../shared/config';
import { createLogger } from '../../shared/logger';

const log = createLogger('providerConfig');

function getProjectPathById(projectId: string): string | null {
  const config = loadGlobalConfig();
  const project = config.projects?.find((p) => p.id === projectId);
  if (!project || project.location.type !== 'local') return null;
  return project.location.path;
}

const scopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('global') }),
  z.object({ type: z.literal('project'), projectId: z.string().min(1) }),
]);

const providerInputSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.string().min(1, 'Type is required'),
  secret_ref: z.string().optional(),
  base_url: z.string().optional(),
  default_model: z.string().optional(),
  endpoint: z.string().optional(),
  max_tokens: z.number().optional(),
  temperature: z.number().optional(),
});

export const providerConfigRouter = router({
  /** List providers by scope: global + per-project (for known projects with local path). */
  list: publicProcedure.query(() => {
    const globalConfig = loadGlobalConfig();
    const global = globalConfig.providers ?? [];
    const projects = globalConfig.projects ?? [];
    const byProject: Array<{
      projectId: string;
      projectName: string;
      path: string;
      providers: ConfigProvider[];
    }> = [];
    for (const proj of projects) {
      if (proj.location.type !== 'local') continue;
      const path = proj.location.path;
      const projectConfig = loadProjectOnlyConfig(path);
      const providers = projectConfig.providers ?? [];
      byProject.push({
        projectId: proj.id,
        projectName: proj.name,
        path,
        providers,
      });
    }
    return { global, projects: byProject };
  }),

  add: publicProcedure
    .input(
      z.object({
        scope: scopeSchema,
        provider: providerInputSchema,
      })
    )
    .mutation(({ input }) => {
      const id = randomUUID();
      const provider: ConfigProvider = {
        id,
        name: input.provider.name.trim(),
        type: input.provider.type.trim(),
        secret_ref: input.provider.secret_ref?.trim(),
        base_url: input.provider.base_url?.trim(),
        default_model: input.provider.default_model?.trim(),
        endpoint: input.provider.endpoint?.trim(),
        max_tokens: input.provider.max_tokens,
        temperature: input.provider.temperature,
      };
      if (input.scope.type === 'global') {
        const config = loadGlobalConfig();
        const providers = config.providers ?? [];
        providers.push(provider);
        config.providers = providers;
        saveGlobalConfig(config);
      } else {
        const path = getProjectPathById(input.scope.projectId);
        if (!path) throw new Error('Project not found or has no local path');
        const config = loadProjectOnlyConfig(path);
        const providers = config.providers ?? [];
        providers.push(provider);
        config.providers = providers;
        saveProjectConfig(config, path);
      }
      log.debug('add provider', id, input.scope);
      return provider;
    }),

  update: publicProcedure
    .input(
      z.object({
        scope: scopeSchema,
        id: z.string().min(1),
        provider: providerInputSchema.partial(),
      })
    )
    .mutation(({ input }) => {
      if (input.scope.type === 'global') {
        const config = loadGlobalConfig();
        const providers = config.providers ?? [];
        const index = providers.findIndex((p) => p.id === input.id);
        if (index === -1) throw new Error('Provider not found');
        const existing = providers[index];
        providers[index] = {
          ...existing,
          name: input.provider.name?.trim() ?? existing.name,
          type: input.provider.type?.trim() ?? existing.type,
          secret_ref: input.provider.secret_ref !== undefined ? input.provider.secret_ref?.trim() : existing.secret_ref,
          base_url: input.provider.base_url !== undefined ? input.provider.base_url?.trim() : existing.base_url,
          default_model: input.provider.default_model !== undefined ? input.provider.default_model?.trim() : existing.default_model,
          endpoint: input.provider.endpoint !== undefined ? input.provider.endpoint?.trim() : existing.endpoint,
          max_tokens: input.provider.max_tokens !== undefined ? input.provider.max_tokens : existing.max_tokens,
          temperature: input.provider.temperature !== undefined ? input.provider.temperature : existing.temperature,
        };
        config.providers = providers;
        saveGlobalConfig(config);
        return providers[index];
      } else {
        const path = getProjectPathById(input.scope.projectId);
        if (!path) throw new Error('Project not found or has no local path');
        const config = loadProjectOnlyConfig(path);
        const providers = config.providers ?? [];
        const index = providers.findIndex((p) => p.id === input.id);
        if (index === -1) throw new Error('Provider not found');
        const existing = providers[index];
        providers[index] = {
          ...existing,
          name: input.provider.name?.trim() ?? existing.name,
          type: input.provider.type?.trim() ?? existing.type,
          secret_ref: input.provider.secret_ref !== undefined ? input.provider.secret_ref?.trim() : existing.secret_ref,
          base_url: input.provider.base_url !== undefined ? input.provider.base_url?.trim() : existing.base_url,
          default_model: input.provider.default_model !== undefined ? input.provider.default_model?.trim() : existing.default_model,
          endpoint: input.provider.endpoint !== undefined ? input.provider.endpoint?.trim() : existing.endpoint,
          max_tokens: input.provider.max_tokens !== undefined ? input.provider.max_tokens : existing.max_tokens,
          temperature: input.provider.temperature !== undefined ? input.provider.temperature : existing.temperature,
        };
        config.providers = providers;
        saveProjectConfig(config, path);
        return providers[index];
      }
    }),

  remove: publicProcedure
    .input(
      z.object({
        scope: scopeSchema,
        id: z.string().min(1),
      })
    )
    .mutation(({ input }) => {
      if (input.scope.type === 'global') {
        const config = loadGlobalConfig();
        const providers = (config.providers ?? []).filter((p) => p.id !== input.id);
        if (providers.length === (config.providers ?? []).length) throw new Error('Provider not found');
        config.providers = providers;
        saveGlobalConfig(config);
      } else {
        const path = getProjectPathById(input.scope.projectId);
        if (!path) throw new Error('Project not found or has no local path');
        const config = loadProjectOnlyConfig(path);
        const providers = (config.providers ?? []).filter((p) => p.id !== input.id);
        if (providers.length === (config.providers ?? []).length) throw new Error('Provider not found');
        config.providers = providers;
        saveProjectConfig(config, path);
      }
      log.debug('remove provider', input.id, input.scope);
      return { id: input.id };
    }),
});
