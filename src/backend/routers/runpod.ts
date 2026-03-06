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

import { z } from 'zod';
import { router, publicProcedure } from '../trpc/trpc';
import * as runpod from '../services/runpod';
import * as runpodProject from '../../shared/runpodProject';
import * as runpodModelSettings from '../services/runpodModelSettings';
import * as runpodTemplates from '../services/runpodTemplates';

const configSchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  endpoint: z.string().optional(),
});

export const runpodRouter = router({
  checkConnection: publicProcedure
    .input(configSchema)
    .mutation(async ({ input }) => runpod.checkConnection(input)),

  getPods: publicProcedure
    .input(configSchema)
    .mutation(async ({ input }) => runpod.getPods(input)),

  /** List pods for the Providers page using existing RunPod config (RUNPOD_API_KEY env). */
  listPodsForProvider: publicProcedure.query(async () => {
    const apiKey = (process.env.RUNPOD_API_KEY ?? '').trim();
    const endpoint = (process.env.RUNPOD_ENDPOINT ?? '').trim();
    if (!apiKey) {
      return { success: false as const, pods: [] as runpod.RunPodPod[], error: 'RunPod is not configured. Set RUNPOD_API_KEY in your environment or configure RunPod on the Configure RunPod tab.' };
    }
    return runpod.getPods({ apiKey, endpoint: endpoint || undefined });
  }),

  startPod: publicProcedure
    .input(configSchema.and(z.object({ podId: z.string().min(1) })))
    .mutation(async ({ input }) => {
      const { podId, ...config } = input;
      return runpod.startPod(config, podId);
    }),

  stopPod: publicProcedure
    .input(configSchema.and(z.object({ podId: z.string().min(1) })))
    .mutation(async ({ input }) => {
      const { podId, ...config } = input;
      return runpod.stopPod(config, podId);
    }),

  deletePod: publicProcedure
    .input(configSchema.and(z.object({ podId: z.string().min(1) })))
    .mutation(async ({ input }) => {
      const { podId, ...config } = input;
      return runpod.deletePod(config, podId);
    }),

  createPod: publicProcedure
    .input(configSchema.and(z.object({ podConfig: z.record(z.unknown()) })))
    .mutation(async ({ input }) => {
      const { podConfig, ...config } = input;
      return runpod.createPod(config, podConfig as Record<string, unknown>);
    }),

  getBilling: publicProcedure
    .input(configSchema)
    .mutation(async ({ input }) => runpod.getBilling(input)),

  getGpuAvailability: publicProcedure
    .input(configSchema)
    .mutation(async ({ input }) => runpod.getGpuAvailability(input)),

  checkProxyHealth: publicProcedure
    .input(z.object({ podId: z.string().min(1), port: z.number().optional() }))
    .query(async ({ input }) =>
      runpod.checkProxyHealth(input.podId, input.port ?? 8000)
    ),

  checkRunpodV1Connectivity: publicProcedure
    .input(z.object({ podId: z.string().min(1), port: z.number().optional() }))
    .query(async ({ input }) =>
      runpod.checkRunpodV1Connectivity(input.podId, input.port ?? 8000)
    ),

  getRunpodModels: publicProcedure
    .input(z.object({ podId: z.string().min(1), port: z.number().optional() }))
    .query(async ({ input }) =>
      runpod.getRunpodModels(input.podId, input.port ?? 8000)
    ),

  getDefaultRunpodPod: publicProcedure.query(({ ctx }) => ({
    defaultPodId: runpodProject.getDefaultPodId(ctx.workspace.getLocalPath() ?? ''),
  })),

  setDefaultRunpodPod: publicProcedure
    .input(z.object({ podId: z.string().nullable() }))
    .mutation(({ ctx, input }) => {
      runpodProject.setDefaultPodId(ctx.workspace.getLocalPath() ?? '', input.podId);
      return { ok: true };
    }),

  getRunpodModelSettings: publicProcedure.query(({ ctx }) =>
    runpodModelSettings.getRunpodModelSettings(ctx.workspace.getLocalPath() ?? '')
  ),

  setRunpodModelSettings: publicProcedure
    .input(
      z.object({
        modelId: z.string().min(1),
        settings: z.object({
          maxModelLen: z.number().optional(),
          containerDiskInGb: z.number().optional(),
          volumeInGb: z.number().optional(),
          vllmArgs: z.string().optional(),
          enableTools: z.boolean().optional(),
          toolParser: z.string().optional(),
          autoToolChoice: z.boolean().optional(),
          dtype: z.string().optional(),
          trustRemoteCode: z.boolean().optional(),
          gpuMemoryUtilization: z.number().optional(),
          seed: z.number().optional(),
          maxNumSeqs: z.number().optional(),
          enforceEager: z.boolean().optional(),
          disableLogStats: z.boolean().optional(),
          generationConfig: z.string().optional(),
        }),
      })
    )
    .mutation(({ ctx, input }) => {
      runpodModelSettings.setRunpodModelSettings(
        ctx.workspace.getLocalPath() ?? '',
        input.modelId,
        input.settings
      );
      return { ok: true };
    }),

  getRunpodTemplates: publicProcedure.query(({ ctx }) =>
    runpodTemplates.getRunpodTemplates(ctx.workspace.getLocalPath() ?? '')
  ),

  saveRunpodTemplate: publicProcedure
    .input(
      z.object({
        name: z.string(),
        podConfig: z.record(z.unknown()),
        estimatedCostPerHour: z.number().optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      return runpodTemplates.saveRunpodTemplate(ctx.workspace.getLocalPath() ?? '', {
        name: input.name,
        podConfig: input.podConfig,
        estimatedCostPerHour: input.estimatedCostPerHour,
      });
    }),

  deleteRunpodTemplate: publicProcedure
    .input(z.object({ templateId: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      runpodTemplates.deleteRunpodTemplate(ctx.workspace.getLocalPath() ?? '', input.templateId);
      return { ok: true };
    }),

  launchRunpodTemplate: publicProcedure
    .input(configSchema.and(z.object({ templateId: z.string().min(1) })))
    .mutation(async ({ ctx, input }) => {
      const templates = runpodTemplates.getRunpodTemplates(ctx.workspace.getLocalPath() ?? '');
      const template = templates.find((t) => t.id === input.templateId);
      if (!template) return { success: false, error: 'Template not found' };
      const { templateId, ...config } = input;
      const podConfig = { ...template.podConfig };
      const baseName =
        (podConfig.name as string) || template.name || 'vllm-pod';
      podConfig.name = `${baseName}-${Date.now()}`;
      const result = await runpod.createPod(config, podConfig);
      if (result.success && result.pod?.id) {
        runpodTemplates.setTemplateLaunchedPodId(
          ctx.workspace.getLocalPath() ?? '',
          templateId,
          result.pod.id
        );
      }
      return result;
    }),

  stopRunpodTemplate: publicProcedure
    .input(configSchema.and(z.object({ templateId: z.string().min(1) })))
    .mutation(async ({ ctx, input }) => {
      const templates = runpodTemplates.getRunpodTemplates(ctx.workspace.getLocalPath() ?? '');
      const template = templates.find((t) => t.id === input.templateId);
      if (!template?.launchedPodId) return { success: true };
      const { templateId, ...config } = input;
      const result = await runpod.stopPod(config, template.launchedPodId);
      if (result.success) {
        runpodTemplates.setTemplateLaunchedPodId(
          ctx.workspace.getLocalPath() ?? '',
          templateId,
          null
        );
      }
      return result;
    }),
});
