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

import type { Workspace } from '../../shared/workspace';
import { getWorkspaceByProjectId, getActiveWorkspace } from '../workspace/resolver';

export type AppContext = {
  workspace: Workspace;
};

/** Options passed by the fetch adapter (req may be undefined for non-fetch). */
type CreateContextOptions = { req?: Request };

export const createContext = async (
  opts?: CreateContextOptions
): Promise<AppContext> => {
  const projectId = opts?.req?.headers?.get?.('X-Active-Project-Id')?.trim();
  const workspace =
    projectId ? getWorkspaceByProjectId(projectId) : null ?? getActiveWorkspace();
  return { workspace };
};

export type Context = Awaited<ReturnType<typeof createContext>>;
