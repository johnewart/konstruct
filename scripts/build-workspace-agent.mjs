#!/usr/bin/env node
/**
 * Bundle workspace-agent and all its TS/source deps into dist/workspace-agent.js.
 * Externals (loaded from node_modules at runtime): tree-sitter*, ws, yaml.
 * For remote deploy, ship this file plus a minimal node_modules with those deps.
 */
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

await esbuild.build({
  entryPoints: [path.join(root, 'src/agent/workspace-agent.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: path.join(root, 'dist/workspace-agent.js'),
  sourcemap: true,
  external: [
    'tree-sitter',
    'tree-sitter-javascript',
    'tree-sitter-python',
    'tree-sitter-typescript',
    'ws',
    'yaml',
  ],
  logLevel: 'info',
});

console.log('Workspace agent bundle written to dist/workspace-agent.js');
