/*
 * Worker thread: runs the codegraph analyzer off the main event loop.
 * Uses the shared codebaseScan module; posts progress and result to parent.
 *
 * workerData: { targetDir: string, stripPrefix: string } (optional: languageExtensions, extensions, maxFiles, skipDirs)
 *
 * Posts: dir | discovery_complete | progress | done | error
 */

import { workerData, parentPort } from 'worker_threads';
/* Resolve shared scan from repo root so worker thread can load it (worker runs with execArgv tsx). */
import {
  runDependencyGraphScan,
  type ScanProgress,
} from '../../shared/codebaseScan.ts';

const input = workerData as {
  targetDir: string;
  stripPrefix: string;
  languageExtensions?: Record<string, string[]>;
  extensions?: string[];
  maxFiles?: number;
  skipDirs?: string[];
};

function onProgress(update: ScanProgress): void {
  switch (update.kind) {
    case 'dir':
      parentPort?.postMessage({
        type: 'dir',
        dir: update.dir,
        filesFound: update.filesFound,
        directoriesScannedSoFar: update.directoriesScannedSoFar,
      });
      break;
    case 'discovery_complete':
      parentPort?.postMessage({
        type: 'discovery_complete',
        directories: update.directories,
        fileCount: update.fileCount,
      });
      break;
    case 'progress':
      parentPort?.postMessage({
        type: 'progress',
        phase: update.phase,
        filesProcessed: update.filesProcessed,
        totalFiles: update.totalFiles,
      });
      break;
    case 'error':
      parentPort?.postMessage({ type: 'error', message: update.message });
      break;
  }
}

(async () => {
  try {
    const result = await runDependencyGraphScan(input.targetDir, input.stripPrefix, {
      languageExtensions: input.languageExtensions,
      extensions: input.extensions,
      maxFiles: input.maxFiles,
      skipDirs: input.skipDirs,
      onProgress,
    });
    parentPort?.postMessage({
      type: 'done',
      nodes: result.nodes,
      edges: result.edges,
      truncated: result.truncated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    parentPort?.postMessage({ type: 'error', message });
    process.exit(1);
  }
})();
