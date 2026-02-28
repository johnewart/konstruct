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
