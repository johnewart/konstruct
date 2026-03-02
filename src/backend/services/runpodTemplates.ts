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
 * RunPod pod templates: central ~/.config/konstruct/runpod-templates.json
 * Templates are configs that can be launched/stopped separately.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getGlobalConfigDir } from '../../shared/config';

export type RunpodTemplate = {
  id: string;
  name: string;
  podConfig: Record<string, unknown>;
  /** Set when launched; used for Stop */
  launchedPodId?: string;
  /** Estimated $/hr when saved (from GPU type at save time) */
  estimatedCostPerHour?: number;
};

const FILENAME = 'runpod-templates.json';

function getCentralPath(): string {
  return path.join(getGlobalConfigDir(), FILENAME);
}

function getLegacyPath(projectRoot: string): string {
  if (!projectRoot) return '';
  return path.join(projectRoot, '.konstruct', FILENAME);
}

function loadRaw(projectRoot?: string): RunpodTemplate[] {
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
  if (!content) return [];
  try {
    const data = JSON.parse(content);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function getRunpodTemplates(projectRoot: string): RunpodTemplate[] {
  return loadRaw(projectRoot);
}

export function saveRunpodTemplate(
  projectRoot: string,
  input: {
    name: string;
    podConfig: Record<string, unknown>;
    estimatedCostPerHour?: number;
  }
): RunpodTemplate {
  const dir = getGlobalConfigDir();
  mkdirSync(dir, { recursive: true });
  const filePath = getCentralPath();
  const list = loadRaw(projectRoot);
  const template: RunpodTemplate = {
    id: randomUUID(),
    name: input.name?.trim() || 'Unnamed',
    podConfig: input.podConfig ?? {},
    launchedPodId: undefined,
    estimatedCostPerHour: input.estimatedCostPerHour,
  };
  list.push(template);
  writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf-8');
  return template;
}

export function deleteRunpodTemplate(
  projectRoot: string,
  templateId: string
): void {
  const filePath = getCentralPath();
  const list = loadRaw(projectRoot).filter((t) => t.id !== templateId);
  writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf-8');
}

export function setTemplateLaunchedPodId(
  projectRoot: string,
  templateId: string,
  podId: string | null
): void {
  const filePath = getCentralPath();
  if (!existsSync(filePath)) return;
  const list = loadRaw(projectRoot);
  const t = list.find((x) => x.id === templateId);
  if (t) {
    t.launchedPodId = podId ?? undefined;
    writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf-8');
  }
}
