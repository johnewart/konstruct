#!/usr/bin/env node
/**
 * Build workspace-agent bundle, then package it with the required node_modules
 * into a zip file for deployment (e.g. dist/workspace-agent-deploy.zip).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const deployDir = path.join(distDir, 'workspace-agent-deploy');
const zipPath = path.join(distDir, 'workspace-agent-deploy.zip');

const EXTERNALS = [
  'tree-sitter',
  'tree-sitter-javascript',
  'tree-sitter-python',
  'tree-sitter-typescript',
  'ws',
  'yaml',
];

// 1. Ensure bundle exists
const bundlePath = path.join(distDir, 'workspace-agent.js');
if (!fs.existsSync(bundlePath)) {
  console.log('Building workspace-agent bundle...');
  const r = spawnSync('npm', ['run', 'build:workspace-agent'], { cwd: root, stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// 2. Read root package.json for versions
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const deps = {};
for (const name of EXTERNALS) {
  if (rootPkg.dependencies?.[name]) deps[name] = rootPkg.dependencies[name];
}

// 3. Clean and create deploy dir
if (fs.existsSync(deployDir)) fs.rmSync(deployDir, { recursive: true });
fs.mkdirSync(deployDir, { recursive: true });

// 4. Copy bundle and sourcemap
fs.copyFileSync(bundlePath, path.join(deployDir, 'workspace-agent.js'));
const mapPath = path.join(distDir, 'workspace-agent.js.map');
if (fs.existsSync(mapPath)) fs.copyFileSync(mapPath, path.join(deployDir, 'workspace-agent.js.map'));

// 5. Write minimal package.json
const deployPkg = {
  name: 'konstruct-workspace-agent',
  version: rootPkg.version || '0.1.0',
  description: 'Konstruct workspace agent (deployable bundle)',
  type: 'module',
  main: 'workspace-agent.js',
  dependencies: deps,
};
fs.writeFileSync(path.join(deployDir, 'package.json'), JSON.stringify(deployPkg, null, 2) + '\n');

// 6. Write README
const readme = `# Konstruct Workspace Agent (deployable)

Unzip this folder. Node modules are included. Run with Node.js 18+:

  WORKSPACE_ID=<id> PROJECT_ROOT=<path> SERVER_URL=<backend-url> node workspace-agent.js

To refresh dependencies: npm install --omit=dev
`;
fs.writeFileSync(path.join(deployDir, 'README.md'), readme);

// 7. npm install in deploy dir
console.log('Installing dependencies in deploy dir...');
const install = spawnSync('npm', ['install', '--omit=dev', '--legacy-peer-deps'], { cwd: deployDir, stdio: 'inherit', shell: true });
if (install.status !== 0) process.exit(install.status ?? 1);

// 8. Create zip (contents of deployDir with prefix so unzip creates one folder)
console.log('Creating zip...');
const out = fs.createWriteStream(zipPath);
const archive = archiver('zip', { z: { level: 9 } });
archive.pipe(out);
archive.directory(deployDir, 'workspace-agent-deploy');
await archive.finalize();
await new Promise((resolve, reject) => {
  out.on('finish', resolve);
  out.on('error', reject);
});

console.log('Deploy package written to', zipPath);
console.log('To deploy: unzip workspace-agent-deploy.zip, then run: WORKSPACE_ID=... PROJECT_ROOT=... SERVER_URL=... node workspace-agent.js');
