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

import { router } from './trpc';
import { documentsRouter } from '../routers/documents';
import { sessionsRouter } from '../routers/sessions';
import { chatRouter } from '../routers/chat';
import { runpodRouter } from '../routers/runpod';
import { gitRouter } from '../routers/git';
import { vmRouter } from '../routers/vm';
import { projectsRouter } from '../routers/projects';
import { providerConfigRouter } from '../routers/providerConfig';
import { reviewRouter } from '../routers/review';
import { githubRouter } from '../routers/github';

export const appRouter = router({
  documents: documentsRouter,
  sessions: sessionsRouter,
  chat: chatRouter,
  runpod: runpodRouter,
  git: gitRouter,
  vm: vmRouter,
  projects: projectsRouter,
  providerConfig: providerConfigRouter,
  review: reviewRouter,
  github: githubRouter,
});

export type AppRouter = typeof appRouter;
