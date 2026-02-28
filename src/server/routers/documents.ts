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
import * as documentStore from '../services/documentStore';
import { createLogger } from '../logger';

const log = createLogger('documents');
const documentTypeSchema = z.enum(['plan', 'design', 'generic']);

export const documentsRouter = router({
  list: publicProcedure.query(() => {
    const docs = documentStore.listDocuments();
    log.debug('list', docs.length, 'documents');
    return docs;
  }),

  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const doc = documentStore.getDocument(input.id);
      if (!doc) throw new Error('Document not found');
      return doc;
    }),

  create: publicProcedure
    .input(
      z.object({
        title: z.string().min(1),
        content: z.string().min(1),
        type: documentTypeSchema.optional().default('generic'),
      })
    )
    .mutation(({ input }) => {
      const doc = documentStore.addDocument({
        title: input.title,
        content: input.content,
        type: input.type,
      });
      return { success: true, id: doc.id, url: `/doc/${doc.id}` };
    }),
});
