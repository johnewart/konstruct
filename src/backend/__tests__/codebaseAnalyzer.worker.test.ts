/**
 * Tests that the codebase analyzer worker is runnable: it can be spawned,
 * receives workerData, and posts back a 'done' message with nodes/edges.
 * Uses a temp dir with a small Python file to avoid depending on fixtures.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Worker } from 'worker_threads';
import { fileURLToPath, pathToFileURL } from 'url';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const SKIP_DIRS = [
  'node_modules', '__pycache__', '.venv', 'venv', '.env',
  'build', 'dist', '.git', '.tox', '.mypy_cache', '.pytest_cache',
  'coverage',
];

describe('codebaseAnalyzer.worker', () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = path.join(os.tmpdir(), `codebase-worker-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'hello.py'),
      'def greet():\n    print("hello")\n',
      'utf8',
    );
  });

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('spawns, analyzes a directory, and posts done with nodes and edges', async () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const workerPath = pathToFileURL(
      path.join(dir, '../workers/codebaseAnalyzer.worker.ts'),
    );
    const stripPrefix = tempDir.replace(/\\/g, '/');
    const stripPrefixWithSlash = stripPrefix.endsWith('/') ? stripPrefix : `${stripPrefix}/`;

    const result = await new Promise<{ nodes: Array<{ id: string; path: string }>; edges: Array<{ source: string; target: string; type: string }>; truncated: boolean }>(
      (resolve, reject) => {
        const worker = new Worker(workerPath, {
          execArgv: ['--import', 'tsx'],
          workerData: {
            targetDir: tempDir,
            language: 'python',
            extensions: ['.py'],
            maxFiles: 5000,
            skipDirs: SKIP_DIRS,
            stripPrefix: stripPrefixWithSlash,
          },
        });

        worker.on('message', (msg: { type: string; nodes?: unknown[]; edges?: unknown[]; truncated?: boolean; message?: string }) => {
          if (msg.type === 'done') {
            resolve({
              nodes: msg.nodes ?? [],
              edges: msg.edges ?? [],
              truncated: msg.truncated ?? false,
            });
            worker.terminate();
          } else if (msg.type === 'error') {
            reject(new Error(msg.message ?? 'Worker reported error'));
            worker.terminate();
          }
        });

        worker.on('error', (err) => {
          reject(err);
        });

        worker.on('exit', (code) => {
          if (code !== 0) {
            reject(new Error(`Worker exited with code ${code}`));
          }
        });
      },
    );

    expect(result.nodes).toBeInstanceOf(Array);
    expect(result.edges).toBeInstanceOf(Array);
    expect(result.truncated).toBe(false);
    // We have one .py file; we expect at least one file node
    expect(result.nodes.length).toBeGreaterThanOrEqual(1);
    const fileNode = result.nodes.find((n) => n.id.startsWith('file://') && n.path.includes('hello.py'));
    expect(fileNode).toBeDefined();
  });
});
