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

import { loadConfig, getProviderById, resolveProviderSecret, saveConfig } from './config';
import { getDefaultPodId } from './runpodProject';

export type ProviderOption = {
  id: string;
  name: string;
};

/** Same as Go AvailableProviders(): openai, anthropic, bedrock, runpod, plus ollama. */
export const PROVIDER_OPTIONS: ProviderOption[] = [
  { id: 'openai', name: 'OpenAI / Vast' },
  { id: 'ollama', name: 'Ollama (local)' },
  { id: 'runpod', name: 'RunPod' },
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'bedrock', name: 'AWS Bedrock' },
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
  if (type === 'openai') return !!(getEnv('OPENAI_API_KEY') || c.llm?.api_key || getVastApiKey(projectRoot));
  if (type === 'anthropic') return !!(getEnv('ANTHROPIC_API_KEY') || c.llm?.api_key);
  if (type === 'runpod') return !!(getEnv('RUNPOD_API_KEY') || c.runpod?.api_key);
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
  const model = getEnv('OPENAI_MODEL') || (c.llm.model ?? '') || 'gpt-4o-mini';
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
    (c.llm.model ?? '') ||
    'claude-sonnet-4-20250514';
  return { apiKey, model };
}

/** Bedrock: region and model from env (AWS_REGION, AWS_BEDROCK_MODEL) or config.llm. */
export function getBedrockEnv(projectRoot: string): {
  region: string;
  model: string;
} {
  const c = loadConfig(projectRoot);
  const region =
    getEnv('AWS_REGION') || getEnv('AWS_DEFAULT_REGION') || 'us-east-1';
  const model =
    getEnv('AWS_BEDROCK_MODEL') ||
    (c.llm.model ?? '') ||
    'anthropic.claude-3-5-sonnet-v2:0';
  return { region, model };
}

/** Bedrock: considered configured if AWS credentials/region are available (SDK default chain). */
export function isBedrockConfigured(projectRoot: string): boolean {
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
  const model = getEnv('OLLAMA_MODEL') || (c.llm.model ?? '') || 'llama3.2';
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
  const model = c.runpod?.model || c.llm?.model || '';
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
    const model =
      provider?.default_model ??
      getEnv('OPENAI_MODEL') ??
      c.llm?.model ??
      'gpt-4o-mini';
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
      c.llm?.model ??
      'claude-sonnet-4-20250514';
    return { apiKey: resolved, model };
  }
  return getAnthropicEnv(projectRoot);
}

/** Async: prefer provider secret_ref, then fall back to sync getRunpodEnv. */
export async function getRunpodEnvAsync(
  projectRoot: string,
  providerId?: string
): Promise<{ baseUrl: string; apiKey: string; model: string }> {
  const c = loadConfig(projectRoot);
  const id = (providerId ?? c.llm?.provider ?? 'runpod').toLowerCase();
  const resolved = await resolveProviderSecret(projectRoot, id);
  const sync = getRunpodEnv(projectRoot);
  if (resolved != null) {
    return { ...sync, apiKey: resolved };
  }
  return sync;
}

/** Returns all provider options for the UI plus default provider from config. */
export function getAllProviders(projectRoot: string): {
  providers: Array<{
    id: string;
    name: string;
    defaultModel: string;
    configured: boolean;
    url?: string;
  }>;
  defaultProviderId: string;
} {
  const c = loadConfig(projectRoot);
  const openaiEnv = getOpenAIEnv(projectRoot);
  const anthropicEnv = getAnthropicEnv(projectRoot);
  const runpodEnv = getRunpodEnv(projectRoot);
  const ollamaEnv = getOllamaEnv(projectRoot);
  const providers: Array<{
    id: string;
    name: string;
    defaultModel: string;
    configured: boolean;
    url?: string;
  }> = [
    {
      id: 'openai',
      name: 'OpenAI / Vast',
      defaultModel: openaiEnv.model,
      configured: !!openaiEnv.apiKey || isProviderConfiguredWithSecret(projectRoot, 'openai', 'openai'),
      url: openaiEnv.baseUrl || undefined,
    },
    {
      id: 'ollama',
      name: 'Ollama (local)',
      defaultModel: ollamaEnv.model,
      configured: !!ollamaEnv.baseUrl,
      url: ollamaEnv.baseUrl || undefined,
    },
    {
      id: 'runpod',
      name: 'RunPod',
      defaultModel: runpodEnv.model || 'default',
      configured: !!runpodEnv.baseUrl || isProviderConfiguredWithSecret(projectRoot, 'runpod', 'runpod'),
      url: runpodEnv.baseUrl || undefined,
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      defaultModel: anthropicEnv.model,
      configured: !!anthropicEnv.apiKey || isProviderConfiguredWithSecret(projectRoot, 'anthropic', 'anthropic'),
    },
    {
      id: 'bedrock',
      name: 'AWS Bedrock',
      defaultModel:
        getEnv('AWS_BEDROCK_MODEL') ||
        'anthropic.claude-3-5-sonnet-20241022-v2',
      configured: isBedrockConfigured(projectRoot),
    },
  ];
  const rawProvider = (c.llm.provider ?? '').trim();
  const isKnown =
    rawProvider &&
    (['anthropic', 'bedrock', 'runpod', 'ollama', 'openai'].includes(rawProvider.toLowerCase()) ||
      getProviderById(c, rawProvider));
  const defaultProviderId: string = isKnown ? rawProvider : 'openai';
  return { providers, defaultProviderId };
}

/** Update the default provider in the config file (project or global). */
export function setDefaultProvider(providerId: string, projectRoot: string): void {
  const validProviders = ['openai', 'anthropic', 'bedrock', 'runpod', 'ollama'];
  if (!validProviders.includes(providerId)) {
    throw new Error(`Invalid provider: ${providerId}. Must be one of: ${validProviders.join(', ')}`);
  }
  const config = loadConfig(projectRoot);
  config.llm = config.llm ?? {};
  config.llm.provider = providerId;
  saveConfig(config, projectRoot);
}
