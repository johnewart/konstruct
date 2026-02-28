import { router } from '../trpc/trpc';
import { documentsRouter } from '../routers/documents';
import { sessionsRouter } from '../routers/sessions';
import { chatRouter } from '../routers/chat';
import { runpodRouter } from '../routers/runpod';

export const appRouter = router({
  documents: documentsRouter,
  sessions: sessionsRouter,
  chat: chatRouter,
  runpod: runpodRouter,
});

export type AppRouter = typeof appRouter;
