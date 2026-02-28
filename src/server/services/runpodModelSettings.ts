/**
 * Per-model RunPod/vLLM settings stored in .konstruct/runpod-models.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

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

function getFilePath(projectRoot: string): string {
  if (!projectRoot) return '';
  return path.join(projectRoot, '.konstruct', FILENAME);
}

function loadRaw(projectRoot: string): Record<string, RunpodModelSettings> {
  const filePath = getFilePath(projectRoot);
  if (!filePath || !existsSync(filePath)) return {};
  try {
    const content = readFileSync(filePath, 'utf-8');
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
  const dir = projectRoot ? path.join(projectRoot, '.konstruct') : '';
  if (!dir || !modelId?.trim()) return;
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, FILENAME);
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
