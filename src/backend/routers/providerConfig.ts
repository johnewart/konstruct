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
import type { ConfigProvider, ProviderModel } from '../../shared/config';
import { createLogger } from '../../shared/logger';
import * as listProviderModels from '../services/listProviderModels';

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

const providerModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  contextWindow: z.number().optional(),
});

const providerInputSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.string().min(1, 'Type is required'),
  secret_ref: z.string().optional(),
  base_url: z.string().optional(),
  default_model: z.string().optional(),
  endpoint: z.string().optional(),
  aws_profile: z.string().optional(),
  runpod_pod_id: z.string().optional(),
  claude_cli_path: z.string().optional(),
  models: z.array(providerModelSchema).optional(),
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
      const isClaudeCli = input.provider.type.trim().toLowerCase() === 'claude_cli';
      let id: string;
      if (input.scope.type === 'global') {
        const config = loadGlobalConfig();
        const existing = config.providers ?? [];
        id = isClaudeCli && !existing.some((p) => (p.id ?? '').toLowerCase() === 'claude_cli')
          ? 'claude_cli'
          : randomUUID();
      } else {
        const path = getProjectPathById(input.scope.projectId);
        if (!path) throw new Error('Project not found or has no local path');
        const config = loadProjectOnlyConfig(path);
        const existing = config.providers ?? [];
        id = isClaudeCli && !existing.some((p) => (p.id ?? '').toLowerCase() === 'claude_cli')
          ? 'claude_cli'
          : randomUUID();
      }
      const provider: ConfigProvider = {
        id,
        name: input.provider.name.trim(),
        type: input.provider.type.trim(),
        secret_ref: input.provider.secret_ref?.trim(),
        base_url: input.provider.base_url?.trim(),
        default_model: input.provider.default_model?.trim(),
        endpoint: input.provider.endpoint?.trim(),
        aws_profile: input.provider.aws_profile?.trim(),
        runpod_pod_id: input.provider.runpod_pod_id?.trim(),
        claude_cli_path: input.provider.claude_cli_path?.trim(),
        models: input.provider.models,
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
          aws_profile: input.provider.aws_profile !== undefined ? input.provider.aws_profile?.trim() : existing.aws_profile,
          runpod_pod_id: input.provider.runpod_pod_id !== undefined ? input.provider.runpod_pod_id?.trim() : existing.runpod_pod_id,
          claude_cli_path: input.provider.claude_cli_path !== undefined ? input.provider.claude_cli_path?.trim() : existing.claude_cli_path,
          models: input.provider.models !== undefined ? input.provider.models : existing.models,
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
          aws_profile: input.provider.aws_profile !== undefined ? input.provider.aws_profile?.trim() : existing.aws_profile,
          runpod_pod_id: input.provider.runpod_pod_id !== undefined ? input.provider.runpod_pod_id?.trim() : existing.runpod_pod_id,
          claude_cli_path: input.provider.claude_cli_path !== undefined ? input.provider.claude_cli_path?.trim() : existing.claude_cli_path,
          models: input.provider.models !== undefined ? input.provider.models : existing.models,
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

  addModel: publicProcedure
    .input(
      z.object({
        scope: scopeSchema,
        providerId: z.string().min(1),
        model: z.object({ name: z.string().min(1), contextWindow: z.number().optional() }),
      })
    )
    .mutation(({ input }) => {
      const id = randomUUID();
      const newModel: ProviderModel = {
        id,
        name: input.model.name.trim(),
        contextWindow: input.model.contextWindow,
      };
      const apply = (providers: ConfigProvider[]): ConfigProvider | null => {
        const idx = providers.findIndex((p) => p.id === input.providerId);
        if (idx === -1) return null;
        const p = providers[idx];
        const models = [...(p.models ?? []), newModel];
        providers[idx] = { ...p, models };
        return providers[idx];
      };
      if (input.scope.type === 'global') {
        const config = loadGlobalConfig();
        const providers = config.providers ?? [];
        const updated = apply(providers);
        if (!updated) throw new Error('Provider not found');
        config.providers = providers;
        saveGlobalConfig(config);
        return newModel;
      } else {
        const path = getProjectPathById(input.scope.projectId);
        if (!path) throw new Error('Project not found or has no local path');
        const config = loadProjectOnlyConfig(path);
        const providers = config.providers ?? [];
        const updated = apply(providers);
        if (!updated) throw new Error('Provider not found');
        config.providers = providers;
        saveProjectConfig(config, path);
        return newModel;
      }
    }),

  updateModel: publicProcedure
    .input(
      z.object({
        scope: scopeSchema,
        providerId: z.string().min(1),
        modelId: z.string().min(1),
        model: z.object({ name: z.string().min(1).optional(), contextWindow: z.number().optional() }).partial(),
      })
    )
    .mutation(({ input }) => {
      const apply = (providers: ConfigProvider[]): ProviderModel | null => {
        const pIdx = providers.findIndex((p) => p.id === input.providerId);
        if (pIdx === -1) return null;
        const p = providers[pIdx];
        const models = p.models ?? [];
        const mIdx = models.findIndex((m) => m.id === input.modelId);
        if (mIdx === -1) return null;
        const updated: ProviderModel = {
          ...models[mIdx],
          name: input.model.name?.trim() ?? models[mIdx].name,
          contextWindow: input.model.contextWindow !== undefined ? input.model.contextWindow : models[mIdx].contextWindow,
        };
        models[mIdx] = updated;
        providers[pIdx] = { ...p, models };
        return updated;
      };
      if (input.scope.type === 'global') {
        const config = loadGlobalConfig();
        const providers = config.providers ?? [];
        const updated = apply(providers);
        if (!updated) throw new Error('Provider or model not found');
        config.providers = providers;
        saveGlobalConfig(config);
        return updated;
      } else {
        const path = getProjectPathById(input.scope.projectId);
        if (!path) throw new Error('Project not found or has no local path');
        const config = loadProjectOnlyConfig(path);
        const providers = config.providers ?? [];
        const updated = apply(providers);
        if (!updated) throw new Error('Provider or model not found');
        config.providers = providers;
        saveProjectConfig(config, path);
        return updated;
      }
    }),

  /** Fetch available models from the provider API (OpenAI, Anthropic, Bedrock). Returns list to merge or replace in provider. */
  refreshProviderModels: publicProcedure
    .input(
      z.object({
        scope: scopeSchema,
        providerId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const projectRoot =
        input.scope.type === 'project'
          ? (getProjectPathById(input.scope.projectId) ?? '')
          : ctx.projectRoot;
      if (input.scope.type === 'project' && !projectRoot) {
        throw new Error('Project not found or has no local path');
      }
      return listProviderModels.listProviderModels(projectRoot, input.providerId);
    }),

  removeModel: publicProcedure
    .input(
      z.object({
        scope: scopeSchema,
        providerId: z.string().min(1),
        modelId: z.string().min(1),
      })
    )
    .mutation(({ input }) => {
      const apply = (providers: ConfigProvider[]): boolean => {
        const pIdx = providers.findIndex((p) => p.id === input.providerId);
        if (pIdx === -1) return false;
        const p = providers[pIdx];
        const models = (p.models ?? []).filter((m) => m.id !== input.modelId);
        providers[pIdx] = { ...p, models };
        return true;
      };
      if (input.scope.type === 'global') {
        const config = loadGlobalConfig();
        const providers = config.providers ?? [];
        if (!apply(providers)) throw new Error('Provider or model not found');
        config.providers = providers;
        saveGlobalConfig(config);
      } else {
        const path = getProjectPathById(input.scope.projectId);
        if (!path) throw new Error('Project not found or has no local path');
        const config = loadProjectOnlyConfig(path);
        const providers = config.providers ?? [];
        if (!apply(providers)) throw new Error('Provider or model not found');
        config.providers = providers;
        saveProjectConfig(config, path);
      }
      return { modelId: input.modelId };
    }),
});
