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

/**
 * RunPod default pod storage: central ~/.config/konstruct/runpod.json
 * (no longer per-repo so .konstruct stays committable).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { getGlobalConfigDir } from './config';

const FILENAME = 'runpod.json';

function getCentralPath(): string {
  return path.join(getGlobalConfigDir(), FILENAME);
}

function getLegacyPath(projectRoot: string): string {
  if (!projectRoot) return '';
  return path.join(projectRoot, '.konstruct', FILENAME);
}

export function getDefaultPodId(projectRoot: string): string | null {
  const centralPath = getCentralPath();
  let content: string | null = null;
  if (existsSync(centralPath)) {
    try {
      content = readFileSync(centralPath, 'utf-8');
    } catch {
      content = null;
    }
  }
  // Migration: if central missing but legacy exists, copy to central
  if (!content && projectRoot) {
    const legacyPath = getLegacyPath(projectRoot);
    if (existsSync(legacyPath)) {
      try {
        content = readFileSync(legacyPath, 'utf-8');
        mkdirSync(getGlobalConfigDir(), { recursive: true });
        writeFileSync(centralPath, content, 'utf-8');
      } catch {
        content = null;
      }
    }
  }
  if (!content) return null;
  try {
    const data = JSON.parse(content) as { defaultPodId?: string };
    const id = data.defaultPodId;
    return typeof id === 'string' && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

export function setDefaultPodId(
  _projectRoot: string,
  podId: string | null
): void {
  const dir = getGlobalConfigDir();
  mkdirSync(dir, { recursive: true });
  const filePath = getCentralPath();
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
