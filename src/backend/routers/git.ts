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

import { router, publicProcedure } from '../trpc/trpc';
import { getChangedFiles, getComprehensiveDiffStats, isGitAvailable } from '../git';

export const gitRouter = router({
  isAvailable: publicProcedure.query(() => isGitAvailable()),

  getChangedFiles: publicProcedure.query(({ ctx }) => {
    const changes = getChangedFiles(ctx.projectRoot);

    if (changes.length === 0) {
      return [] as const;
    }

    // Get comprehensive diff stats for all changed files
    const stats = getComprehensiveDiffStats(ctx.projectRoot);

    return changes.map((change) => {
      const fileStats = stats.get(change.path) || { added: 0, removed: 0 };
      return {
        ...change,
        added: fileStats.added,
        removed: fileStats.removed,
      };
    });
  }),
});
