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
  getActiveProjectId,
  setActiveProjectId,
  getActiveProjectRoot,
} from '../../shared/config';
import type { KonstructProject } from '../../shared/config';
import { createLogger } from '../../shared/logger';

const log = createLogger('projects');

const locationSchema = z.object({
  type: z.literal('local'),
  path: z.string().min(1, 'Path is required'),
});

const addProjectSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  gitRepositoryUrl: z.string().min(1, 'Git repository URL is required'),
  location: locationSchema,
});

const updateProjectSchema = z.object({
  id: z.string().min(1, 'Project id is required'),
  name: z.string().min(1).optional(),
  gitRepositoryUrl: z.string().min(1).optional(),
  location: locationSchema.optional(),
});

export const projectsRouter = router({
  list: publicProcedure.query(() => {
    const config = loadGlobalConfig();
    const projects = config.projects ?? [];
    log.debug('list', projects.length, 'projects');
    return projects;
  }),

  add: publicProcedure
    .input(addProjectSchema)
    .mutation(({ input }) => {
      const config = loadGlobalConfig();
      const projects = config.projects ?? [];
      const id = randomUUID();
      const project: KonstructProject = {
        id,
        name: input.name.trim(),
        gitRepositoryUrl: input.gitRepositoryUrl.trim(),
        location: { type: 'local', path: input.location.path.trim() },
      };
      projects.push(project);
      config.projects = projects;
      saveGlobalConfig(config);
      log.debug('add', id, project.name);
      return project;
    }),

  update: publicProcedure
    .input(updateProjectSchema)
    .mutation(({ input }) => {
      const config = loadGlobalConfig();
      const projects = config.projects ?? [];
      const index = projects.findIndex((p) => p.id === input.id);
      if (index === -1) throw new Error('Project not found');
      const existing = projects[index];
      const updated: KonstructProject = {
        ...existing,
        name: input.name?.trim() ?? existing.name,
        gitRepositoryUrl: input.gitRepositoryUrl?.trim() ?? existing.gitRepositoryUrl,
        location: input.location ?? existing.location,
      };
      projects[index] = updated;
      config.projects = projects;
      saveGlobalConfig(config);
      log.debug('update', input.id);
      return updated;
    }),

  remove: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ input }) => {
      const config = loadGlobalConfig();
      const projects = config.projects ?? [];
      const filtered = projects.filter((p) => p.id !== input.id);
      if (filtered.length === projects.length) throw new Error('Project not found');
      config.projects = filtered;
      if (getActiveProjectId() === input.id) config.activeProjectId = undefined;
      saveGlobalConfig(config);
      log.debug('remove', input.id);
      return { id: input.id };
    }),

  getActive: publicProcedure.query(() => {
    const id = getActiveProjectId();
    if (!id) return null;
    const config = loadGlobalConfig();
    const project = config.projects?.find((p) => p.id === id);
    if (!project) return null;
    const root = getActiveProjectRoot();
    return {
      id: project.id,
      name: project.name,
      root: root ?? undefined,
    };
  }),

  setActive: publicProcedure
    .input(z.object({ projectId: z.string().nullable() }))
    .mutation(({ input }) => {
      if (input.projectId === '') {
        setActiveProjectId(null);
        return { projectId: null };
      }
      setActiveProjectId(input.projectId);
      log.debug('setActive', input.projectId);
      return { projectId: getActiveProjectId() };
    }),
});
