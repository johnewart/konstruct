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
 * Per-model RunPod/vLLM settings: central ~/.config/konstruct/runpod-models.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { getGlobalConfigDir } from '../../shared/config';

export type RunpodModelSettings = {
  maxModelLen?: number;
  containerDiskInGb?: number;
  volumeInGb?: number;
  vllmArgs?: string;
  enableTools?: boolean;
  toolParser?: string;
  autoToolChoice?: boolean;
  dtype?: string;
  trustRemoteCode?: boolean;
  gpuMemoryUtilization?: number;
  seed?: number;
  maxNumSeqs?: number;
  enforceEager?: boolean;
  disableLogStats?: boolean;
  generationConfig?: string;
};

const FILENAME = 'runpod-models.json';

function getCentralPath(): string {
  return path.join(getGlobalConfigDir(), FILENAME);
}

function getLegacyPath(projectRoot: string): string {
  if (!projectRoot) return '';
  return path.join(projectRoot, '.konstruct', FILENAME);
}

function loadRaw(projectRoot?: string): Record<string, RunpodModelSettings> {
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
  if (!content) return {};
  try {
    const data = JSON.parse(content);
    return typeof data === 'object' && data !== null ? data : {};
  } catch {
    return {};
  }
}

export function getRunpodModelSettings(
  projectRoot: string
): Record<string, RunpodModelSettings> {
  return loadRaw(projectRoot);
}

export function setRunpodModelSettings(
  projectRoot: string,
  modelId: string,
  settings: Partial<RunpodModelSettings>
): void {
  if (!modelId?.trim()) return;
  const dir = getGlobalConfigDir();
  mkdirSync(dir, { recursive: true });
  const filePath = getCentralPath();
  const all = loadRaw(projectRoot);
  const key = modelId.trim();
  const current = all[key] ?? {};
  const next: RunpodModelSettings = { ...current };
  if (settings.maxModelLen !== undefined)
    next.maxModelLen = settings.maxModelLen;
  if (settings.containerDiskInGb !== undefined)
    next.containerDiskInGb = settings.containerDiskInGb;
  if (settings.volumeInGb !== undefined) next.volumeInGb = settings.volumeInGb;
  if (settings.vllmArgs !== undefined) next.vllmArgs = settings.vllmArgs;
  if (settings.enableTools !== undefined)
    next.enableTools = settings.enableTools;
  if (settings.toolParser !== undefined) next.toolParser = settings.toolParser;
  if (settings.autoToolChoice !== undefined)
    next.autoToolChoice = settings.autoToolChoice;
  if (settings.dtype !== undefined) next.dtype = settings.dtype;
  if (settings.trustRemoteCode !== undefined)
    next.trustRemoteCode = settings.trustRemoteCode;
  if (settings.gpuMemoryUtilization !== undefined)
    next.gpuMemoryUtilization = settings.gpuMemoryUtilization;
  if (settings.seed !== undefined) next.seed = settings.seed;
  if (settings.maxNumSeqs !== undefined) next.maxNumSeqs = settings.maxNumSeqs;
  if (settings.enforceEager !== undefined)
    next.enforceEager = settings.enforceEager;
  if (settings.disableLogStats !== undefined)
    next.disableLogStats = settings.disableLogStats;
  if (settings.generationConfig !== undefined)
    next.generationConfig = settings.generationConfig;
  all[key] = next;
  writeFileSync(filePath, JSON.stringify(all, null, 2), 'utf-8');
}
