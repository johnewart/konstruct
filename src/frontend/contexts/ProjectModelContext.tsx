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

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { trpc } from '../../client/trpc';

const PROJECT_MODEL_KEY_PREFIX = 'konstruct-project';

function getProjectModelKeys(projectId: string) {
  return {
    provider: `${PROJECT_MODEL_KEY_PREFIX}-${projectId}-provider`,
    model: `${PROJECT_MODEL_KEY_PREFIX}-${projectId}-model`,
  };
}

function readProjectModel(projectId: string): { providerId: string | null; modelId: string | null } {
  if (typeof window === 'undefined' || !projectId) return { providerId: null, modelId: null };
  const keys = getProjectModelKeys(projectId);
  return {
    providerId: localStorage.getItem(keys.provider),
    modelId: localStorage.getItem(keys.model),
  };
}

function writeProjectModel(projectId: string, providerId: string, modelId: string): void {
  if (typeof window === 'undefined' || !projectId) return;
  const keys = getProjectModelKeys(projectId);
  localStorage.setItem(keys.provider, providerId);
  localStorage.setItem(keys.model, modelId);
}

export interface ProjectModelContextValue {
  /** Active project id from backend (null when no project selected). */
  projectId: string | null;
  /** Project-scoped provider id (only set when projectId is set and user has chosen one). */
  providerId: string | null;
  /** Project-scoped model id (only set when projectId is set and user has chosen one). */
  modelId: string | null;
  /** True when a project is active and we should use project-scoped provider/model everywhere. */
  isProjectScope: boolean;
  /** Set provider + model for the current project (persists to localStorage). No-op when projectId is null. */
  setProjectModel: (providerId: string, modelId: string) => void;
}

const ProjectModelContext = createContext<ProjectModelContextValue | null>(null);

export function ProjectModelProvider({ children }: { children: React.ReactNode }) {
  const { data: active } = trpc.projects.getActive.useQuery();
  const projectId = active?.id ?? null;

  const [providerId, setProviderIdState] = useState<string | null>(null);
  const [modelId, setModelIdState] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setProviderIdState(null);
      setModelIdState(null);
      return;
    }
    const { providerId: p, modelId: m } = readProjectModel(projectId);
    setProviderIdState(p);
    setModelIdState(m);
  }, [projectId]);

  const setProjectModelMutation = trpc.projects.setProjectModel.useMutation();
  const setProjectModel = useCallback(
    (nextProviderId: string, nextModelId: string) => {
      if (!projectId) return;
      writeProjectModel(projectId, nextProviderId, nextModelId);
      setProviderIdState(nextProviderId);
      setModelIdState(nextModelId);
      setProjectModelMutation.mutate({
        projectId,
        providerId: nextProviderId,
        modelId: nextModelId,
      });
    },
    [projectId, setProjectModelMutation]
  );

  const value: ProjectModelContextValue = {
    projectId,
    providerId,
    modelId,
    isProjectScope: projectId != null,
    setProjectModel,
  };

  return (
    <ProjectModelContext.Provider value={value}>
      {children}
    </ProjectModelContext.Provider>
  );
}

export function useProjectModel(): ProjectModelContextValue {
  const ctx = useContext(ProjectModelContext);
  if (!ctx) {
    return {
      projectId: null,
      providerId: null,
      modelId: null,
      isProjectScope: false,
      setProjectModel: () => {},
    };
  }
  return ctx;
}
