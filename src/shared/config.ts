/*
 * Copyright 2026 John Ewart <john@johnewart.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use it except in compliance with the License.
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
 * Config loader: global ~/.config/konstruct/config.yml plus optional
 * project overlay .konstruct/config.yml (deep merge). Config stores
 * types and secret references (env: or 1pass:), not raw secrets.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { parse, stringify } from 'yaml';
import { createLogger } from './logger.ts';

const log = createLogger('config');

/** Known project: name, git URL, and where to find it (local path or VM). */
export type KonstructProject = {
  id: string;
  name: string;
  gitRepositoryUrl: string;
  location: {
    type: 'local';
    path: string;
  };
};

/** Per-provider model: name and optional context window (for max_tokens). */
export type ProviderModel = {
  id: string;
  name: string;
  contextWindow?: number;
};

/** Provider definition: type + type-specific config (secret_ref, base_url, aws_profile, etc.). */
export type ConfigProvider = {
  id: string;
  name: string;
  type: string;
  /** Secret reference: env:VAR_NAME or 1pass:op://Vault/Item/field (OpenAI, Anthropic, RunPod). */
  secret_ref?: string;
  /** Optional base URL override (OpenAI-compatible). */
  base_url?: string;
  /** Optional default model id/name (can be omitted; UI may send model per request). */
  default_model?: string;
  endpoint?: string;
  /** AWS profile name for Bedrock (uses SDK default chain if unset). */
  aws_profile?: string;
  /** RunPod: selected pod id (provider uses this pod's proxy URL). */
  runpod_pod_id?: string;
  /** Claude CLI: path to the claude binary (e.g. /path/to/node/bin/claude). */
  claude_cli_path?: string;
  /** Managed list of models (name + context window) for this provider. */
  models?: ProviderModel[];
  max_tokens?: number;
  temperature?: number;
  [key: string]: unknown;
};

export type KonstructConfig = {
  /** Current default provider (legacy + default). Model is per-provider. */
  llm: {
    provider?: string;
    api_key?: string;
    base_url?: string;
    max_tokens?: number;
    temperature?: number;
  };
  /** Provider list: id, name, type, secret_ref, and type-specific options. */
  providers?: ConfigProvider[];
  /** Known projects (global config only): name, git URL, location (local path or VM). */
  projects?: KonstructProject[];
  /** Id of the currently active project. When set and project is local, agent uses its path as root. */
  activeProjectId?: string | null;
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
    max_tokens: 4096,
    temperature: 0.7,
  },
};

/** Global config path: ~/.config/konstruct/config.yml */
export function getGlobalConfigPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return path.join(home, '.config', 'konstruct', 'config.yml');
}

/** Global config directory: ~/.config/konstruct (e.g. for projects/<id>/sessions.json). */
export function getGlobalConfigDir(): string {
  return path.dirname(getGlobalConfigPath());
}

/**
 * Resolve project id for a given project root. Returns the known project id if the root
 * matches a project's local path, otherwise null (caller may use '_default').
 */
export function getProjectIdForRoot(projectRoot: string): string | null {
  if (!projectRoot?.trim()) return null;
  const config = loadGlobalConfig();
  const resolvedRoot = path.resolve(projectRoot);
  const project = config.projects?.find(
    (p) =>
      p.location.type === 'local' &&
      path.resolve(p.location.path) === resolvedRoot
  );
  return project?.id ?? null;
}

/** Project config path: <projectRoot>/.konstruct/config.yml */
export function getProjectConfigPath(projectRoot: string): string {
  if (!projectRoot) return '';
  return path.join(projectRoot, '.konstruct', 'config.yml');
}

function deepMerge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...base };
  for (const key of Object.keys(overlay)) {
    const baseVal = result[key];
    const overlayVal = overlay[key];
    if (
      overlayVal != null &&
      typeof overlayVal === 'object' &&
      !Array.isArray(overlayVal) &&
      baseVal != null &&
      typeof baseVal === 'object' &&
      !Array.isArray(baseVal)
    ) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overlayVal as Record<string, unknown>
      );
    } else {
      result[key] = overlayVal;
    }
  }
  return result;
}

/** Normalize raw parsed YAML to KonstructConfig. */
function normalize(raw: Record<string, unknown> | null): KonstructConfig {
  if (!raw || typeof raw !== 'object') return defaultConfig;
  const llm = raw.llm as Record<string, unknown> | undefined;
  const providers = raw.providers as ConfigProvider[] | undefined;
  return {
    llm: {
      provider: (llm?.provider ??
        llm?.Provider ??
        defaultConfig.llm.provider) as string,
      api_key: (llm?.api_key ?? llm?.APIKey ?? llm?.apikey ?? '') as string,
      base_url: (llm?.base_url ?? llm?.BaseURL ?? llm?.baseurl ?? '') as string,
      max_tokens: (llm?.max_tokens ??
        llm?.max_tokens ??
        defaultConfig.llm.max_tokens) as number,
      temperature: (llm?.temperature ??
        defaultConfig.llm.temperature) as number,
    },
    providers: Array.isArray(providers)
      ? providers.map((p) => {
          const base = (p && typeof p === 'object' ? { ...p } : {}) as Record<string, unknown>;
          const rawModels = p?.models as Array<Record<string, unknown>> | undefined;
          const models: ProviderModel[] | undefined = Array.isArray(rawModels)
            ? rawModels
              .filter((m) => m && (m.id ?? m.name))
              .map((m, i) => ({
                id: String(m?.id ?? m?.name ?? `model-${i}`),
                name: String(m?.name ?? m?.id ?? ''),
                contextWindow:
                  m?.contextWindow != null || m?.context_window != null
                    ? Number(m?.contextWindow ?? m?.context_window)
                    : undefined,
              }))
            : undefined;
          return {
            ...base,
            id: String(p?.id ?? ''),
            name: String(p?.name ?? p?.id ?? ''),
            type: String(p?.type ?? ''),
            secret_ref: p?.secret_ref ? String(p.secret_ref).trim() : undefined,
            base_url: p?.base_url != null ? String(p.base_url) : undefined,
            default_model: p?.default_model != null ? String(p.default_model) : undefined,
            endpoint: p?.endpoint != null ? String(p.endpoint) : undefined,
            aws_profile: p?.aws_profile != null ? String(p.aws_profile).trim() : undefined,
            runpod_pod_id: p?.runpod_pod_id != null ? String(p.runpod_pod_id).trim() : undefined,
            claude_cli_path: p?.claude_cli_path != null ? String(p.claude_cli_path).trim() : undefined,
            models: models?.length ? models : undefined,
            max_tokens: p?.max_tokens != null ? Number(p.max_tokens) : undefined,
            temperature: p?.temperature != null ? Number(p.temperature) : undefined,
          } as ConfigProvider;
        })
      : undefined,
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
    activeProjectId:
      raw.activeProjectId === undefined || raw.activeProjectId === null
        ? undefined
        : String(raw.activeProjectId).trim() || undefined,
    projects: (() => {
      const arr = raw.projects as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(arr)) return undefined;
      return arr.map((p, index) => {
        const loc = p?.location as Record<string, unknown> | undefined;
        const type = (loc?.type ?? 'local') as string;
        const pathVal = (loc?.path ?? '') as string;
        const name = String(p?.name ?? '');
        const id = (String(p?.id ?? '').trim() || `project-${index}`);
        return {
          id,
          name,
          gitRepositoryUrl: String(p?.gitRepositoryUrl ?? p?.git_repository_url ?? ''),
          location: {
            type: type === 'local' ? 'local' : 'local',
            path: pathVal,
          },
        } as KonstructProject;
      }).filter((proj) => proj.name || proj.gitRepositoryUrl);
    })(),
  };
}

const cache = new Map<string, KonstructConfig>();
const GLOBAL_ONLY_CACHE_KEY = '__global_only__';

/**
 * Load only the global config file (~/.config/konstruct/config.yml). No project overlay.
 * Use for reading/writing central config (e.g. projects list).
 */
export function loadGlobalConfig(): KonstructConfig {
  const cached = cache.get(GLOBAL_ONLY_CACHE_KEY);
  if (cached !== undefined) return cached;
  let raw: Record<string, unknown> = {};
  const globalPath = getGlobalConfigPath();
  if (existsSync(globalPath)) {
    try {
      const content = readFileSync(globalPath, 'utf-8');
      const parsed = parse(content) as Record<string, unknown> | null;
      if (parsed && typeof parsed === 'object') raw = parsed;
    } catch (e) {
      log.warn('Failed to load global config', globalPath, e);
    }
  }
  const config = normalize(raw);
  cache.set(GLOBAL_ONLY_CACHE_KEY, config);
  return config;
}

/**
 * Save config to the global file only (~/.config/konstruct/config.yml).
 * Use when updating central config (e.g. projects). Clears config caches.
 */
export function saveGlobalConfig(config: KonstructConfig): void {
  const globalPath = getGlobalConfigPath();
  const dir = path.dirname(globalPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const obj = config as unknown as Record<string, unknown>;
  writeFileSync(globalPath, stringify(obj), 'utf-8');
  cache.clear();
}

/**
 * Get the currently active project id from global config (if any).
 */
export function getActiveProjectId(): string | null {
  const config = loadGlobalConfig();
  const id = config.activeProjectId?.trim();
  return id ?? null;
}

/**
 * Set the active project id in global config. Pass null to clear (use cwd/env).
 */
export function setActiveProjectId(projectId: string | null): void {
  const config = loadGlobalConfig();
  config.activeProjectId = projectId ?? undefined;
  saveGlobalConfig(config);
}

/**
 * Get the root directory for the active project. For local projects returns the
 * resolved path; for VM/container (future) returns null until implemented.
 * Returns null if no active project or project not found.
 */
export function getActiveProjectRoot(): string | null {
  const id = getActiveProjectId();
  if (!id) return null;
  const config = loadGlobalConfig();
  const project = config.projects?.find((p) => p.id === id);
  if (!project || project.location.type !== 'local') return null;
  return path.resolve(project.location.path);
}

/**
 * Load only the project config file (.konstruct/config.yml). No global merge.
 * Use when reading/writing project-scoped config (e.g. providers for this project).
 */
export function loadProjectOnlyConfig(projectRoot: string): KonstructConfig {
  if (!projectRoot) return normalize({});
  const projectPath = getProjectConfigPath(projectRoot);
  if (!existsSync(projectPath)) return normalize({});
  try {
    const content = readFileSync(projectPath, 'utf-8');
    const parsed = parse(content) as Record<string, unknown> | null;
    return normalize(parsed && typeof parsed === 'object' ? parsed : {});
  } catch (e) {
    log.warn('Failed to load project-only config', projectPath, e);
    return normalize({});
  }
}

/**
 * Save config to the project file only (.konstruct/config.yml).
 * Creates .konstruct directory if needed. Clears that project's merged cache.
 */
export function saveProjectConfig(config: KonstructConfig, projectRoot: string): void {
  if (!projectRoot) return;
  const projectPath = getProjectConfigPath(projectRoot);
  const dir = path.dirname(projectPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const obj = config as unknown as Record<string, unknown>;
  writeFileSync(projectPath, stringify(obj), 'utf-8');
  cache.delete(projectRoot);
}

/**
 * Load config for a project: global config then project overlay (deep merge).
 * Global: ~/.config/konstruct/config.yml
 * Project: <projectRoot>/.konstruct/config.yml (overrides global when present).
 */
export function loadConfig(projectRoot: string): KonstructConfig {
  const cacheKey = projectRoot || '__global__';
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  let raw: Record<string, unknown> = {};
  const globalPath = getGlobalConfigPath();
  if (existsSync(globalPath)) {
    try {
      const content = readFileSync(globalPath, 'utf-8');
      const parsed = parse(content) as Record<string, unknown> | null;
      if (parsed && typeof parsed === 'object') raw = parsed;
    } catch (e) {
      log.warn('Failed to load global config', globalPath, e);
    }
  }

  const projectPath = getProjectConfigPath(projectRoot);
  if (projectRoot && existsSync(projectPath)) {
    try {
      const content = readFileSync(projectPath, 'utf-8');
      const parsed = parse(content) as Record<string, unknown> | null;
      if (parsed && typeof parsed === 'object') raw = deepMerge(raw, parsed);
    } catch (e) {
      log.warn('Failed to load project config', projectPath, e);
    }
  }

  const config = normalize(raw);
  cache.set(cacheKey, config);
  return config;
}

/**
 * Get a provider by id from config. Returns undefined if not found.
 */
export function getProviderById(
  config: KonstructConfig,
  providerId: string
): ConfigProvider | undefined {
  const id = (providerId ?? '').toLowerCase();
  return config.providers?.find(
    (p) => (p.id ?? '').toLowerCase() === id
  );
}

/**
 * Resolve the secret for a provider. Uses provider.secret_ref if set;
 * returns a promise that resolves to the secret string.
 * Call only from backend/CLI (not browser).
 */
export async function resolveProviderSecret(
  projectRoot: string,
  providerId: string
): Promise<string | null> {
  const { resolveSecretRef } = await import('./secretResolver');
  const config = loadConfig(projectRoot);
  const provider = getProviderById(config, providerId);
  if (!provider?.secret_ref?.trim()) return null;
  try {
    return await resolveSecretRef(provider.secret_ref);
  } catch (e) {
    log.warn('Failed to resolve provider secret', { providerId, ref: provider.secret_ref }, e);
    return null;
  }
}

/**
 * Save config to project or global path. Writes only non-sensitive fields.
 * If projectRoot is set and project config exists, writes there; otherwise global.
 */
export function saveConfig(config: KonstructConfig, projectRoot: string): void {
  const projectPath = getProjectConfigPath(projectRoot);
  const globalPath = getGlobalConfigPath();
  const writePath =
    projectRoot && existsSync(projectPath) ? projectPath : globalPath;
  const dir = path.dirname(writePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const obj = config as unknown as Record<string, unknown>;
  writeFileSync(writePath, stringify(obj), 'utf-8');
  cache.delete(projectRoot || '__global__');
}
