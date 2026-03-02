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

import type { ConfigProvider, ProviderModel } from '../../shared/config';
import { loadConfig, getProviderById, resolveProviderSecret } from '../../shared/config';
import { createLogger } from '../../shared/logger';

const log = createLogger('listProviderModels');

export type ListModelsResult = { models: ProviderModel[]; error?: string };

const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Fetch available models from the provider's API. Supports OpenAI-compatible (OpenAI, RunPod, etc.),
 * Anthropic, and AWS Bedrock (ListFoundationModels).
 */
export async function listProviderModels(
  projectRoot: string,
  providerId: string
): Promise<ListModelsResult> {
  const config = loadConfig(projectRoot);
  const provider = getProviderById(config, providerId);
  if (!provider) {
    return { models: [], error: `Provider "${providerId}" not found` };
  }
  const type = (provider.type ?? '').toLowerCase();

  if (type === 'openai') {
    return listOpenAICompatible(projectRoot, providerId, provider, undefined);
  }
  if (type === 'runpod') {
    const podId = (provider as { runpod_pod_id?: string }).runpod_pod_id?.trim();
    const baseUrl = podId
      ? `https://${podId}-8000.proxy.runpod.net/v1`
      : (provider.base_url ?? '').trim() || undefined;
    return listOpenAICompatible(projectRoot, providerId, provider, baseUrl);
  }
  if (type === 'anthropic') {
    return listAnthropic(projectRoot, providerId, provider);
  }
  if (type === 'bedrock') {
    return listBedrock(projectRoot, providerId, provider);
  }
  return { models: [], error: `Listing models for type "${type}" is not supported` };
}

async function listOpenAICompatible(
  projectRoot: string,
  providerId: string,
  provider: ConfigProvider,
  baseUrlOverride?: string
): Promise<ListModelsResult> {
  const apiKey = await resolveProviderSecret(projectRoot, providerId);
  const base =
    (baseUrlOverride != null && baseUrlOverride.trim() !== '')
      ? baseUrlOverride.trim()
      : (provider.base_url ?? '').trim();
  const baseUrl = base !== '' ? base : 'https://api.openai.com/v1';
  const url = baseUrl.replace(/\/$/, '') + '/models';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey?.trim()) headers.Authorization = `Bearer ${apiKey}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { models: [], error: `API error ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as { data?: Array<{ id: string; root?: string }> };
    const models: ProviderModel[] = (data.data ?? []).map((m) => ({
      id: m.id ?? '',
      name: m.id ?? m.root ?? '',
    })).filter((m) => m.id);
    return { models };
  } catch (e) {
    log.warn('OpenAI-compatible list models failed', { url, providerId }, e);
    return { models: [], error: (e as Error).message };
  }
}

async function listAnthropic(
  projectRoot: string,
  providerId: string,
  _provider: ConfigProvider
): Promise<ListModelsResult> {
  const apiKey = await resolveProviderSecret(projectRoot, providerId);
  if (!apiKey?.trim()) {
    return { models: [], error: 'Provider has no secret_ref or secret could not be resolved' };
  }
  try {
    const res = await fetch(ANTHROPIC_MODELS_URL, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { models: [], error: `API error ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as {
      data?: Array<{ id: string; display_name?: string }>;
      has_more?: boolean;
      last_id?: string;
    };
    const models: ProviderModel[] = (data.data ?? []).map((m) => ({
      id: m.id ?? '',
      name: (() => { const d = (m.display_name ?? m.id ?? '').trim(); return d !== '' ? d : (m.id ?? ''); })(),
    })).filter((m) => m.id);
    let page = data;
    while (page.has_more && page.last_id) {
      const next = await fetch(`${ANTHROPIC_MODELS_URL}?after_id=${encodeURIComponent(page.last_id)}`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'Content-Type': 'application/json',
        },
      });
      if (!next.ok) break;
      page = (await next.json()) as typeof data;
      for (const m of page.data ?? []) {
        models.push({
          id: m.id ?? '',
          name: (() => { const d = (m.display_name ?? m.id ?? '').trim(); return d !== '' ? d : (m.id ?? ''); })(),
        });
      }
    }
    return { models };
  } catch (e) {
    log.warn('Anthropic list models failed', { providerId }, e);
    return { models: [], error: (e as Error).message };
  }
}

async function listBedrock(
  _projectRoot: string,
  providerId: string,
  provider: ConfigProvider
): Promise<ListModelsResult> {
  try {
    const bedrock = await import('@aws-sdk/client-bedrock');
    const { fromNodeProviderChain, fromIni } = await import('@aws-sdk/credential-providers');
    const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
    const profile = (provider as { aws_profile?: string }).aws_profile?.trim();
    const credentialProvider = profile
      ? fromIni({ profile })
      : fromNodeProviderChain();
    const client = new bedrock.BedrockClient({
      region,
      credentials: credentialProvider,
    });
    const models: ProviderModel[] = [];
    let nextToken: string | undefined;
    do {
      const cmd = new bedrock.ListFoundationModelsCommand({
        nextToken,
        maxResults: 100,
      });
      const out = await client.send(cmd);
      const list = (out as { modelSummaries?: Array<{ modelId?: string; modelName?: string }> }).modelSummaries ?? [];
      for (const m of list) {
        const id = m.modelId ?? '';
        if (id) {
          models.push({
            id,
            name: (m.modelName ?? id).trim() || id,
          });
        }
      }
      nextToken = (out as { nextToken?: string }).nextToken;
    } while (nextToken);
    return { models };
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('Cannot find module') && msg.includes('client-bedrock')) {
      return { models: [], error: 'Bedrock model list requires @aws-sdk/client-bedrock. Install it to list Bedrock models.' };
    }
    log.warn('Bedrock list models failed', { providerId }, e);
    return { models: [], error: (e as Error).message };
  }
}
