/**
 * Per-project RunPod default pod storage (.konstruct/runpod.json).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

const FILENAME = 'runpod.json';

function getFilePath(projectRoot: string): string {
  if (!projectRoot) return '';
  return path.join(projectRoot, '.konstruct', FILENAME);
}

export function getDefaultPodId(projectRoot: string): string | null {
  const filePath = getFilePath(projectRoot);
  if (!filePath || !existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content) as { defaultPodId?: string };
    const id = data.defaultPodId;
    return typeof id === 'string' && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

export function setDefaultPodId(
  projectRoot: string,
  podId: string | null
): void {
  const dir = projectRoot ? path.join(projectRoot, '.konstruct') : '';
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, FILENAME);
  if (podId == null || (typeof podId === 'string' && podId.trim() === '')) {
    writeFileSync(filePath, JSON.stringify({}, null, 2), 'utf-8');
    return;
  }
  writeFileSync(
    filePath,
    JSON.stringify({ defaultPodId: podId.trim() }, null, 2),
    'utf-8'
  );
}
