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

import * as path from 'node:path';
import { loadGlobalConfig, getActiveProjectId } from '../../shared/config';
import type { Workspace } from '../../shared/workspace';
import { LocalWorkspace } from './LocalWorkspace';

/**
 * Resolve a project id to a Workspace. Returns null if project not found or not local.
 * VM/container workspaces can be added later.
 */
export function getWorkspaceByProjectId(projectId: string): Workspace | null {
  const config = loadGlobalConfig();
  const project = config.projects?.find((p) => p.id === projectId);
  if (!project) return null;
  if (project.location.type === 'local') {
    return new LocalWorkspace(project.id, project.location.path);
  }
  // VM/container: not implemented yet
  return null;
}

/**
 * Get the active workspace (from active project id or fallback to cwd). Never returns null.
 */
export function getActiveWorkspace(): Workspace {
  const id = getActiveProjectId();
  const w = id ? getWorkspaceByProjectId(id) : null;
  if (w) return w;
  return new LocalWorkspace('default', process.cwd());
}

/**
 * Resolve a project root path to a workspace (e.g. for MCP session). Uses project config if path matches a local project; otherwise a LocalWorkspace with that path.
 */
export function getWorkspaceByProjectRoot(projectRoot: string): Workspace {
  const resolved = path.resolve(projectRoot);
  const config = loadGlobalConfig();
  const project = config.projects?.find(
    (p) => p.location.type === 'local' && path.resolve(p.location.path) === resolved
  );
  if (project) return new LocalWorkspace(project.id, project.location.path);
  return new LocalWorkspace(resolved, resolved);
}
