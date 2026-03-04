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

import { getActiveProjectRootFresh } from '../../shared/config';

export type AppContext = {
  projectRoot: string;
};

export const createContext = (): AppContext => {
  const activeRoot = getActiveProjectRootFresh();
  const projectRoot =
    activeRoot ?? process.env.PROJECT_ROOT ?? process.cwd();
  return { projectRoot };
};

export type Context = Awaited<ReturnType<typeof createContext>>;
