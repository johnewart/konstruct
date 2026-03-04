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
 * LLM provider config. Uses ~/.config/konstruct/config.yml and optional
 * .konstruct/config.yml overlay. Secrets via env vars or refs (env: or 1pass:).
 */

import { loadConfig, loadGlobalConfig, getProviderById, resolveProviderSecret, saveGlobalConfig } from './config';
import type { ProviderModel } from './config';
import { getDefaultPodId } from './runpodProject';

export type ProviderOption = {
  id: string;
  name: string;
};

/** Same as Go AvailableProviders(): openai, anthropic, bedrock, runpod, plus ollama and claude_cli. */
export const PROVIDER_OPTIONS: ProviderOption[] = [
  { id: 'openai', name: 'OpenAI / Vast' },
  { id: 'ollama', name: 'Ollama (local)' },
  { id: 'runpod', name: 'RunPod' },
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'bedrock', name: 'AWS Bedrock' },
  { id: 'claude_cli', name: 'Claude CLI (agent)' },
];

function getEnv(name: string): string {
  return (typeof process !== 'undefined' && process.env?.[name]) ?? '';
}

function getVastApiKey(projectRoot: string): string {
  const c = loadConfig(projectRoot);
  return getEnv('VAST_API_KEY') || c.vast?.api_key || '';
}

/** True if provider has credentials (env, legacy api_key, or config provider with secret_ref). */
function isProviderConfiguredWithSecret(
  projectRoot: string,
  providerId: string,
  type: 'openai' | 'anthropic' | 'runpod'
): boolean {
  const c = loadConfig(projectRoot);
  const provider = getProviderById(c, providerId);
  if (provider?.secret_ref?.trim()) return true;
  if (type === 'openai') return !!(getEnv('OPENAI_API_KEY') || getVastApiKey(projectRoot));
  if (type === 'anthropic') return !!getEnv('ANTHROPIC_API_KEY');
  if (type === 'runpod') return !!getEnv('RUNPOD_API_KEY');
  return false;
}

/** OpenAI-compatible provider. Precedence: env (OPENAI_*) then config.llm, then "vast" if Vast key set. */
export function getOpenAIEnv(projectRoot: string): {
  baseUrl: string;
  apiKey: string;
  model: string;
} {
  const c = loadConfig(projectRoot);
  const baseUrl =
    getEnv('OPENAI_BASE_URL') ||
    (c.llm.base_url ?? '') ||
    'https://api.openai.com/v1';
  let apiKey = getEnv('OPENAI_API_KEY') || (c.llm.api_key ?? '');
  if (!apiKey && getVastApiKey(projectRoot)) apiKey = 'vast';
  const model = 'gpt-4o-mini';
  return { baseUrl, apiKey, model };
}

/** Anthropic: env (ANTHROPIC_*) then config.llm (Go uses config.LLM.APIKey for Anthropic too). */
export function getAnthropicEnv(projectRoot: string): {
  apiKey: string;
  model: string;
} {
  const c = loadConfig(projectRoot);
  const apiKey = getEnv('ANTHROPIC_API_KEY') || (c.llm.api_key ?? '');
  const model =
    getEnv('ANTHROPIC_MODEL') ||
    'claude-sonnet-4-20250514';
  return { apiKey, model };
}

/** Bedrock: region, model, and optional aws_profile from provider or env. */
export function getBedrockEnv(
  projectRoot: string,
  providerId?: string
): { region: string; model: string; aws_profile?: string } {
  const c = loadConfig(projectRoot);
  const provider = providerId ? getProviderById(c, providerId) : undefined;
  const region =
    getEnv('AWS_REGION') || getEnv('AWS_DEFAULT_REGION') || 'us-east-1';
  const model =
    provider?.default_model ||
    'anthropic.claude-3-5-sonnet-v2:0';
  const aws_profile = provider?.aws_profile?.trim();
  return { region, model, ...(aws_profile ? { aws_profile } : {}) };
}

const DEFAULT_CLAUDE_CLI_PATH =
  (typeof process !== 'undefined' && process.env?.CLAUDE_CLI_PATH) ||
  (typeof process !== 'undefined' && process.env?.NVM_BIN ? `${process.env.NVM_BIN}/claude` : null) ||
  'claude';

/** Claude CLI: path from provider config or env (CLAUDE_CLI_PATH / NVM_BIN/claude) or "claude". */
export function getClaudeCliPath(projectRoot: string, providerId?: string): string {
  const c = loadConfig(projectRoot);
  const id = (providerId ?? c.llm?.provider ?? 'claude_cli').toLowerCase();
  const provider = getProviderById(c, id);
  const path = provider?.claude_cli_path?.trim();
  if (path) return path;
  if (id === 'claude_cli') return DEFAULT_CLAUDE_CLI_PATH;
  return DEFAULT_CLAUDE_CLI_PATH;
}

/** Bedrock: configured if AWS credentials/region available or provider has aws_profile. */
export function isBedrockConfigured(projectRoot: string, providerId?: string): boolean {
  if (providerId) {
    const c = loadConfig(projectRoot);
    const p = getProviderById(c, providerId);
    if (p?.aws_profile?.trim()) return true;
  }
  return (
    getEnv('AWS_REGION').length > 0 || getEnv('AWS_ACCESS_KEY_ID').length > 0
  );
}

const RUNPOD_PROXY_PORT = 8000;

/** Ollama: local OpenAI-compatible API. No API key. Default http://localhost:11434/v1 */
export function getOllamaEnv(projectRoot: string): {
  baseUrl: string;
  model: string;
} {
  const c = loadConfig(projectRoot);
  const baseUrl =
    getEnv('OLLAMA_BASE_URL') ||
    (c.llm.base_url ?? '') ||
    'http://localhost:11434/v1';
  const model =
    getEnv('OLLAMA_MODEL') ||
    'llama3.2';
  return { baseUrl, model };
}

/** RunPod: uses default pod's proxy URL. API key optional (can be set in template). */
export function getRunpodEnv(projectRoot: string): {
  baseUrl: string;
  apiKey: string;
  model: string;
} {
  const c = loadConfig(projectRoot);
  const defaultPodId = getDefaultPodId(projectRoot);
  const apiKey = getEnv('RUNPOD_API_KEY') || (c.runpod?.api_key ?? '');
  const model = c.runpod?.model ?? '';
  if (!defaultPodId) {
    return {
      baseUrl: '',
      apiKey,
      model: model || 'default',
    };
  }
  const baseUrl = `https://${defaultPodId}-${RUNPOD_PROXY_PORT}.proxy.runpod.net/v1`;
  return { baseUrl, apiKey, model: model || 'default' };
}

/** Async: prefer provider secret_ref (env: or 1pass:), then fall back to sync getOpenAIEnv. */
export async function getOpenAIEnvAsync(
  projectRoot: string,
  providerId?: string
): Promise<{ baseUrl: string; apiKey: string; model: string }> {
  const c = loadConfig(projectRoot);
  const id = (providerId ?? c.llm?.provider ?? 'openai').toLowerCase();
  const resolved = await resolveProviderSecret(projectRoot, id);
  if (resolved != null) {
    const provider = getProviderById(c, id);
    const baseUrl =
      provider?.base_url ??
      getEnv('OPENAI_BASE_URL') ??
      c.llm?.base_url ??
      'https://api.openai.com/v1';
    const model = provider?.default_model ?? 'gpt-4o-mini';
    return { baseUrl, apiKey: resolved, model };
  }
  return getOpenAIEnv(projectRoot);
}

/** Async: prefer provider secret_ref, then fall back to sync getAnthropicEnv. */
export async function getAnthropicEnvAsync(
  projectRoot: string,
  providerId?: string
): Promise<{ apiKey: string; model: string }> {
  const c = loadConfig(projectRoot);
  const id = (providerId ?? c.llm?.provider ?? 'anthropic').toLowerCase();
  const resolved = await resolveProviderSecret(projectRoot, id);
  if (resolved != null) {
    const provider = getProviderById(c, id);
    const model =
      provider?.default_model ??
      getEnv('ANTHROPIC_MODEL') ??
      'claude-sonnet-4-20250514';
    return { apiKey: resolved, model };
  }
  return getAnthropicEnv(projectRoot);
}

/** Async: when provider has runpod_pod_id use its URL; else use default pod + secret. */
export async function getRunpodEnvAsync(
  projectRoot: string,
  providerId?: string
): Promise<{ baseUrl: string; apiKey: string; model: string }> {
  const c = loadConfig(projectRoot);
  const id = (providerId ?? c.llm?.provider ?? 'runpod').toLowerCase();
  const provider = getProviderById(c, id);
  const podId = provider?.runpod_pod_id?.trim();
  if (podId) {
    const baseUrl = `https://${podId}-${RUNPOD_PROXY_PORT}.proxy.runpod.net/v1`;
    const apiKey = (await resolveProviderSecret(projectRoot, id)) ?? getEnv('RUNPOD_API_KEY') ?? (c.runpod?.api_key ?? '');
    const model = provider?.default_model ?? c.runpod?.model ?? 'default';
    return { baseUrl, apiKey, model };
  }
  const resolved = await resolveProviderSecret(projectRoot, id);
  const sync = getRunpodEnv(projectRoot);
  if (resolved != null) {
    return { ...sync, apiKey: resolved };
  }
  return sync;
}

export type ProviderListItem = {
  id: string;
  name: string;
  defaultModel?: string;
  models: ProviderModel[];
  configured: boolean;
  url?: string;
};

/** Returns provider options for the current context: only providers you have added in config (global + project). No built-in list. */
export function getAllProviders(projectRoot: string): {
  providers: ProviderListItem[];
  defaultProviderId: string;
} {
  const c = loadConfig(projectRoot);
  const globalConfig = loadGlobalConfig();
  const customProviderList = globalConfig.providers ?? [];
  const runpodEnv = getRunpodEnv(projectRoot);
  const customProviders: ProviderListItem[] = customProviderList.map((p) => {
    const type = (p.type ?? '').toLowerCase();
    let configured = false;
    let url: string | undefined;
    if (type === 'openai') {
      configured = !!p.secret_ref?.trim() || !!p.base_url?.trim();
      url = p.base_url ?? undefined;
    } else if (type === 'anthropic') {
      configured = !!p.secret_ref?.trim();
    } else if (type === 'bedrock') {
      configured = !!p.aws_profile?.trim() || isBedrockConfigured(projectRoot, p.id);
    } else if (type === 'runpod') {
      const podId = (p as { runpod_pod_id?: string }).runpod_pod_id?.trim();
      configured = !!podId || !!p.secret_ref?.trim();
      url = podId
        ? `https://${podId}-8000.proxy.runpod.net/v1`
        : runpodEnv.baseUrl || undefined;
    } else if (type === 'ollama') {
      configured = !!(p.base_url?.trim());
      url = p.base_url ?? undefined;
    } else if (type === 'claude_cli') {
      const path = (p as { claude_cli_path?: string }).claude_cli_path?.trim();
      configured = !!path || !!getEnv('CLAUDE_CLI_PATH');
    } else {
      configured = !!p.secret_ref?.trim();
      url = p.base_url ?? undefined;
    }
    return {
      id: p.id,
      name: p.name,
      defaultModel: p.default_model ?? undefined,
      models: p.models ?? [],
      configured,
      url,
    };
  });
  const providers = customProviders;
  const rawProvider = (c.llm.provider ?? '').trim();
  const inList = providers.some((p) => (p.id ?? '').toLowerCase() === rawProvider.toLowerCase());
  const defaultProviderId: string = inList ? rawProvider : (providers[0]?.id ?? '');
  return { providers, defaultProviderId };
}

/**
 * Resolve context window (max_tokens) for a model from the provider's models list.
 * Returns undefined if provider has no models list or model not found.
 */
export function getContextWindowForModel(
  projectRoot: string,
  providerId: string,
  model: string
): number | undefined {
  const c = loadConfig(projectRoot);
  const provider = getProviderById(c, providerId);
  const models = provider?.models;
  if (!models?.length || !model) return undefined;
  const m = models.find((x) => x.name === model || x.id === model);
  return m?.contextWindow;
}

/** Update the default provider in global config. */
export function setDefaultProvider(providerId: string, projectRoot: string): void {
  const config = loadGlobalConfig();
  const exists = config.providers?.some((p) => (p.id ?? '').toLowerCase() === providerId.toLowerCase());
  if (!exists) {
    throw new Error(`Invalid provider: ${providerId}. Add the provider in LLM Providers first.`);
  }
  config.llm = config.llm ?? {};
  config.llm.provider = providerId;
  saveGlobalConfig(config);
}
