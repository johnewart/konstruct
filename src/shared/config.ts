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
 * Config loader compatible with the Go app (internal/config/config.go).
 * Loads .konstruct/config.yml from project root if present, otherwise ~/.config/code_assist/config.yml.
 */

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { parse } from 'yaml';
import { createLogger } from './logger';

const log = createLogger('config');

export type KonstructConfig = {
  llm: {
    provider?: string;
    model?: string;
    api_key?: string;
    base_url?: string;
    max_tokens?: number;
    temperature?: number;
  };
  runpod?: {
    api_key?: string;
    endpoint?: string;
    pod_id?: string;
    model?: string;
  };
  vast?: {
    api_key?: string;
    instance_id?: string;
    model?: string;
  };
};

const defaultConfig: KonstructConfig = {
  llm: {
    provider: 'openai',
    model: 'gpt-4',
    max_tokens: 4096,
    temperature: 0.7,
  },
};

function getGlobalConfigPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return path.join(home, '.config', 'code_assist', 'config.yml');
}

function getProjectConfigPath(projectRoot: string): string {
  if (!projectRoot) return '';
  return path.join(projectRoot, '.konstruct', 'config.yml');
}

/** Normalize raw parsed YAML (snake_case or lowercase keys) to our shape. */
function normalize(raw: Record<string, unknown> | null): KonstructConfig {
  if (!raw || typeof raw !== 'object') return defaultConfig;
  const llm = raw.llm as Record<string, unknown> | undefined;
  return {
    llm: {
      provider: (llm?.provider ??
        llm?.Provider ??
        defaultConfig.llm.provider) as string,
      model: (llm?.model ?? llm?.Model ?? defaultConfig.llm.model) as string,
      api_key: (llm?.api_key ?? llm?.APIKey ?? llm?.apikey ?? '') as string,
      base_url: (llm?.base_url ?? llm?.BaseURL ?? llm?.baseurl ?? '') as string,
      max_tokens: (llm?.max_tokens ??
        llm?.max_tokens ??
        defaultConfig.llm.max_tokens) as number,
      temperature: (llm?.temperature ??
        defaultConfig.llm.temperature) as number,
    },
    runpod: raw.runpod as KonstructConfig['runpod'],
    vast: (() => {
      const v = raw.vast as Record<string, unknown> | undefined;
      if (!v) return undefined;
      return {
        api_key: (v.api_key ?? v.apikey ?? '') as string,
        instance_id: (v.instance_id ?? v.instanceid ?? '') as string,
        model: (v.model ?? '') as string,
      };
    })(),
  };
}

const cache = new Map<string, KonstructConfig>();

/**
 * Load config for a project. Uses .konstruct/config.yml in projectRoot if it exists,
 * otherwise ~/.config/code_assist/config.yml. Matches Go LoadConfigForProject.
 */
export function loadConfig(projectRoot: string): KonstructConfig {
  const cacheKey = projectRoot || '__global__';
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  let pathToLoad: string;
  const projectPath = getProjectConfigPath(projectRoot);
  if (projectRoot && existsSync(projectPath)) {
    pathToLoad = projectPath;
  } else {
    pathToLoad = getGlobalConfigPath();
  }

  let config = defaultConfig;
  if (existsSync(pathToLoad)) {
    try {
      const content = readFileSync(pathToLoad, 'utf-8');
      const raw = parse(content) as Record<string, unknown> | null;
      config = normalize(raw);
    } catch (e) {
      log.warn('Failed to load', pathToLoad, e);
    }
  }
  cache.set(cacheKey, config);
  return config;
}
