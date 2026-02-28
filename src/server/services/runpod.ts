/**
 * RunPod API service - proxies REST and GraphQL calls.
 * API key is passed per-request from the client (no server-side storage).
 */

import { createLogger } from '../logger';

const log = createLogger('runpod');
const REST_DEFAULT = 'https://rest.runpod.io/v1';
const GRAPHQL_ENDPOINT = 'https://api.runpod.io/graphql';

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, '');
}

async function runpodFetch(
  url: string,
  options: RequestInit & { apiKey: string }
): Promise<Response> {
  const { apiKey, ...rest } = options;
  const headers = new Headers(rest.headers as HeadersInit);
  headers.set('Authorization', `Bearer ${apiKey}`);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(url, { ...rest, headers });
}

export interface RunPodConfig {
  apiKey: string;
  endpoint?: string;
}

export async function checkConnection(config: RunPodConfig): Promise<{
  success: boolean;
  status?: string;
  error?: string;
}> {
  const { apiKey, endpoint = REST_DEFAULT } = config;
  if (!apiKey?.trim()) {
    return { success: false, status: 'error', error: 'API key is required' };
  }
  const base = normalizeEndpoint(endpoint);
  const url = `${base}/pods`;
  try {
    const res = await runpodFetch(url, { method: 'GET', apiKey });
    if (res.ok) return { success: true, status: 'connected' };
    const text = await res.text().catch(() => '');
    let msg = `HTTP ${res.status}: ${res.statusText}`;
    try {
      const data = JSON.parse(text);
      if (data.message) msg = data.message;
      else if (data.error) msg = data.error;
    } catch {
      // use default msg
    }
    return { success: false, status: 'disconnected', error: msg };
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo'))
      return {
        success: false,
        status: 'error',
        error: 'Cannot resolve hostname. Check internet and endpoint URL.',
      };
    if (msg.includes('ECONNREFUSED'))
      return {
        success: false,
        status: 'error',
        error: 'Connection refused. Endpoint may be incorrect or server down.',
      };
    if (msg.includes('ETIMEDOUT') || msg.includes('timeout'))
      return {
        success: false,
        status: 'error',
        error: 'Connection timeout. Check internet.',
      };
    return { success: false, status: 'error', error: msg };
  }
}

export interface RunPodPod {
  id: string;
  name: string;
  status: string;
  gpuCount: number;
  uptimeSeconds?: number;
  createdAt?: string;
  lastStartedAt?: string;
  costPerHour?: number;
  memoryGb?: number;
  containerDiskGb?: number;
  volumeGb?: number;
  diskGb?: number;
  vcpuCount?: number;
  imageName?: string;
  ports?: string[];
  publicIp?: string;
  templateId?: string;
  /** When status is RUNNING, true if proxy /health returned OK. */
  proxyReady?: boolean;
  machine?: {
    gpuName: string;
    gpuCount: number;
    gpuMemoryGb?: number;
    mem: number;
    disk: number;
  };
  resources?: { cpu?: number; memory?: number; gpu?: number };
}

export async function getPods(config: RunPodConfig): Promise<{
  success: boolean;
  pods?: RunPodPod[];
  error?: string;
}> {
  const { apiKey, endpoint = REST_DEFAULT } = config;
  if (!apiKey?.trim()) {
    return { success: false, error: 'API key is required' };
  }
  const base = normalizeEndpoint(endpoint);
  const url = `${base}/pods`;
  try {
    const res = await runpodFetch(url, { method: 'GET', apiKey });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let msg = `API error: ${res.status} ${text}`;
      try {
        const data = JSON.parse(text);
        if (data.message) msg = data.message;
        else if (data.error) msg = data.error;
      } catch {
        // ignore
      }
      throw new Error(msg);
    }
    const data = (await res.json()) as any;
    const rawPods = Array.isArray(data) ? data : (data.data ?? data.pods ?? []);
    const pods: RunPodPod[] = rawPods.map((pod: any) => {
      let uptimeSeconds: number | undefined;
      if (pod.lastStartedAt || pod.startTime) {
        const start = new Date(pod.lastStartedAt || pod.startTime).getTime();
        uptimeSeconds = Math.floor((Date.now() - start) / 1000);
      } else if (pod.uptime) uptimeSeconds = pod.uptime;

      let gpuName = 'Unknown',
        gpuCount = 0,
        gpuMemoryGb: number | undefined;
      if (pod.machine) {
        gpuName =
          pod.machine.gpuType ||
          pod.machine.gpuName ||
          pod.machine.gpuModel ||
          pod.machine.podHostId ||
          pod.machine.hardwareType ||
          pod.machine.type ||
          'Unknown';
        gpuCount = pod.machine.gpuCount || 0;
        gpuMemoryGb =
          pod.machine.gpuMemoryInGb ??
          pod.machine.gpuMemory ??
          pod.machine.gpuMem ??
          (pod.machine.gpuMemoryBytes
            ? pod.machine.gpuMemoryBytes / 1024 ** 3
            : undefined);
      }
      if (gpuName === 'Unknown') {
        gpuName =
          pod.gpuType ||
          pod.gpuName ||
          pod.gpuModel ||
          pod.template?.gpuType ||
          pod.template?.gpuName ||
          'Unknown';
      }
      if (gpuCount === 0) gpuCount = pod.gpuCount ?? 0;
      if (gpuMemoryGb === undefined) {
        gpuMemoryGb =
          pod.gpuMemoryInGb ??
          pod.gpuMemory ??
          pod.gpuMem ??
          pod.template?.gpuMemoryInGb ??
          pod.template?.gpuMemory ??
          (pod.gpuMemoryBytes ? pod.gpuMemoryBytes / 1024 ** 3 : undefined);
      }

      const costPerHour =
        pod.costPerHr ??
        pod.costPerHour ??
        pod.hourlyCost ??
        pod.pricePerHour ??
        pod.machine?.costPerHour ??
        pod.template?.costPerHour;
      const memoryGb =
        pod.memoryInGb ??
        pod.machine?.memoryInGb ??
        pod.machine?.mem ??
        (pod.machine?.memory ? pod.machine.memory / 1024 ** 3 : undefined);
      const containerDiskGb = pod.containerDiskInGb;
      const volumeGb = pod.volumeInGb;
      const diskGb =
        containerDiskGb ??
        volumeGb ??
        pod.machine?.diskSize ??
        (pod.machine?.disk ? pod.machine.disk / 1024 ** 3 : undefined);

      return {
        id: pod.id,
        name: pod.name || pod.id,
        status:
          pod.lastStatus ||
          pod.desiredStatus ||
          pod.status ||
          pod.state ||
          'UNKNOWN',
        gpuCount,
        uptimeSeconds,
        createdAt: pod.createdAt ?? pod.created,
        lastStartedAt: pod.lastStartedAt ?? pod.startTime,
        costPerHour,
        memoryGb,
        containerDiskGb,
        volumeGb,
        diskGb,
        vcpuCount: pod.vcpuCount ?? pod.cpuCount,
        imageName: pod.imageName,
        ports: pod.ports ?? [],
        publicIp: pod.publicIp,
        templateId: pod.templateId,
        machine: {
          gpuName,
          gpuCount,
          gpuMemoryGb,
          mem: memoryGb
            ? memoryGb * 1024 ** 3
            : (pod.machine?.mem ?? pod.machine?.memory ?? 0),
          disk: diskGb
            ? diskGb * 1024 ** 3
            : (pod.machine?.disk ?? pod.machine?.diskSize ?? 0),
        },
        resources: {
          cpu: pod.cpuUtilization ?? pod.cpu,
          memory: pod.memoryUtilization ?? pod.memory,
          gpu: pod.gpuUtilization ?? pod.gpu,
        },
      };
    });
    const runningPods = pods.filter(
      (p) => (p.status || '').toUpperCase() === 'RUNNING'
    );
    if (runningPods.length > 0) {
      const healthResults = await Promise.all(
        runningPods.map((p) =>
          checkProxyHealth(p.id, 8000).then((r) => ({
            id: p.id,
            isReady: r.isReady === true,
          }))
        )
      );
      const readyById = new Map(healthResults.map((r) => [r.id, r.isReady]));
      for (const p of pods) {
        if ((p.status || '').toUpperCase() === 'RUNNING')
          p.proxyReady = readyById.get(p.id);
      }
    }
    return { success: true, pods };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function startPod(
  config: RunPodConfig,
  podId: string
): Promise<{ success: boolean; pod?: any; error?: string }> {
  const { apiKey, endpoint = REST_DEFAULT } = config;
  if (!apiKey?.trim()) return { success: false, error: 'API key is required' };
  if (!podId) return { success: false, error: 'Pod ID is required' };
  const base = normalizeEndpoint(endpoint);
  const url = `${base}/pods/${podId}/start`;
  try {
    const res = await runpodFetch(url, { method: 'POST', apiKey });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let msg =
        res.status === 403
          ? '403 Forbidden: API key needs write permissions. Create a new key with write permissions in RunPod settings.'
          : `Failed to start pod: ${res.status} ${text}`;
      try {
        const data = JSON.parse(text);
        if (Array.isArray(data) && data[0]?.error) msg = data[0].error;
        else if (data.message) msg = data.message;
        else if (data.error) msg = data.error;
      } catch {
        // ignore
      }
      throw new Error(msg);
    }
    const data = await res.json();
    return { success: true, pod: data };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function stopPod(
  config: RunPodConfig,
  podId: string
): Promise<{ success: boolean; pod?: any; error?: string }> {
  const { apiKey, endpoint = REST_DEFAULT } = config;
  if (!apiKey?.trim()) return { success: false, error: 'API key is required' };
  if (!podId) return { success: false, error: 'Pod ID is required' };
  const base = normalizeEndpoint(endpoint);
  const url = `${base}/pods/${podId}/stop`;
  try {
    const res = await runpodFetch(url, { method: 'POST', apiKey });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let msg =
        res.status === 403
          ? '403 Forbidden: API key needs write permissions.'
          : `Failed to stop pod: ${res.status} ${text}`;
      try {
        const data = JSON.parse(text);
        if (data.message) msg = data.message;
        else if (data.error) msg = data.error;
      } catch {
        // ignore
      }
      throw new Error(msg);
    }
    const data = await res.json();
    return { success: true, pod: data };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function deletePod(
  config: RunPodConfig,
  podId: string
): Promise<{ success: boolean; error?: string }> {
  const { apiKey, endpoint = REST_DEFAULT } = config;
  if (!apiKey?.trim()) return { success: false, error: 'API key is required' };
  if (!podId) return { success: false, error: 'Pod ID is required' };
  const base = normalizeEndpoint(endpoint);
  const url = `${base}/pods/${podId}`;
  try {
    const res = await runpodFetch(url, { method: 'DELETE', apiKey });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let msg =
        res.status === 403
          ? '403 Forbidden: API key needs write permissions.'
          : `Failed to delete pod: ${res.status} ${text}`;
      try {
        const data = JSON.parse(text);
        if (data.message) msg = data.message;
        else if (data.error) msg = data.error;
      } catch {
        // ignore
      }
      throw new Error(msg);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function createPod(
  config: RunPodConfig,
  podConfig: Record<string, unknown>
): Promise<{ success: boolean; pod?: any; error?: string }> {
  const { apiKey, endpoint = REST_DEFAULT } = config;
  if (!apiKey?.trim()) return { success: false, error: 'API key is required' };
  const base = normalizeEndpoint(endpoint);
  const url = `${base}/pods`;
  try {
    const res = await runpodFetch(url, {
      method: 'POST',
      apiKey,
      body: JSON.stringify(podConfig),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let msg =
        res.status === 403
          ? '403 Forbidden: API key needs write permissions.'
          : `Failed to create pod: ${res.status} ${text}`;
      try {
        const data = JSON.parse(text);
        if (Array.isArray(data) && data[0]?.error) msg = data[0].error;
        else if (data.message) msg = data.message;
        else if (data.error) msg = data.error;
      } catch {
        // ignore
      }
      throw new Error(msg);
    }
    const data = await res.json();
    return { success: true, pod: data };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

const GET_BILLING_QUERY = `
  query GetBilling {
    myself {
      underBalance
      minBalance
      currentSpendPerHr
      clientLifetimeSpend
      clientBalance
      spendLimit
    }
  }
`;

export interface RunPodBilling {
  credits?: number | null;
  minBalance?: number | null;
  currentSpendPerHr?: number | null;
  lifetimeSpend?: number | null;
  spendLimit?: number | null;
  currency: string;
  raw?: any;
}

export async function getBilling(config: RunPodConfig): Promise<{
  success: boolean;
  data?: RunPodBilling;
  error?: string;
}> {
  const { apiKey } = config;
  if (!apiKey?.trim()) return { success: false, error: 'API key is required' };
  try {
    const res = await runpodFetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      apiKey,
      body: JSON.stringify({ query: GET_BILLING_QUERY }),
    });
    const result = (await res.json()) as any;
    if (result.errors?.length) {
      const hasData = result.data?.myself;
      if (!hasData) {
        const msg = result.errors.map((e: any) => e.message).join(', ');
        return { success: false, error: `GraphQL: ${msg}` };
      }
    }
    const user = result.data?.myself;
    if (!user) return { success: false, error: 'No user data from GraphQL' };
    const credits =
      user.clientBalance != null
        ? user.clientBalance
        : user.underBalance != null
          ? Math.max(0, user.underBalance)
          : null;
    const data: RunPodBilling = {
      credits,
      minBalance: user.minBalance ?? null,
      currentSpendPerHr: user.currentSpendPerHr ?? null,
      lifetimeSpend: user.clientLifetimeSpend ?? null,
      spendLimit: user.spendLimit ?? null,
      currency: 'USD',
      raw: user,
    };
    return { success: true, data };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

const GET_GPU_TYPES_QUERY = `
  query GetGpuTypes {
    gpuTypes {
      id
      displayName
      memoryInGb
      secureCloud
      communityCloud
      lowestPrice {
        minimumBidPrice
        uninterruptablePrice
      }
      securePrice
      communityPrice
      nodeGroupDatacenters {
        id
        name
        location
        gpuAvailability {
          available
          stockStatus
          gpuTypeId
          gpuTypeDisplayName
          displayName
          id
        }
      }
    }
  }
`;

const GET_DATACENTERS_QUERY = `
  query GetDataCenters {
    dataCenters {
      id
      name
      location
    }
  }
`;

type GpuAvailabilitySummary = {
  availableRegions: number;
  stockStatus: string | null;
};

export type DatacenterAvailabilityEntry = {
  datacenterId: string;
  datacenterName: string;
  location: string;
  stockStatus: string | null;
};

/** Rank for "worst" status: lower = worse. API uses High, Medium, Low; we also handle OUT_OF_STOCK. */
const STOCK_STATUS_RANK: Record<string, number> = {
  OUT_OF_STOCK: 0,
  OUT_OF_STOCK_LOW_SUPPLY: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  IN_STOCK: 3,
};

function isOutOfStock(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toUpperCase().replace(/-/g, '_');
  return s === 'OUT_OF_STOCK' || s === 'OUT_OF_STOCK_LOW_SUPPLY';
}

function computeAvailabilitySummary(
  gpuId: string,
  nodeGroupDatacenters: Array<{
    id?: string;
    name?: string;
    location?: string;
    gpuAvailability?: Array<{
      gpuTypeId?: string;
      available?: boolean;
      stockStatus?: string;
    }>;
  }>
): GpuAvailabilitySummary | null {
  if (!Array.isArray(nodeGroupDatacenters)) return null;
  let availableRegions = 0;
  let worstStatus: string | null = null;
  for (const dc of nodeGroupDatacenters) {
    const list = dc.gpuAvailability;
    if (!Array.isArray(list)) continue;
    const entry = list.find((e) => e.gpuTypeId === gpuId);
    if (!entry) continue;
    const s = (entry.stockStatus ?? '').trim();
    const normalized = s ? s.toUpperCase().replace(/-/g, '_') : '';
    if (entry.available === true || (s && !isOutOfStock(s)))
      availableRegions += 1;
    if (
      normalized &&
      (worstStatus == null ||
        (STOCK_STATUS_RANK[normalized] ?? 3) <
          (STOCK_STATUS_RANK[worstStatus] ?? 3))
    )
      worstStatus = normalized || s || null;
  }
  if (availableRegions === 0 && worstStatus == null) return null;
  return { availableRegions, stockStatus: worstStatus };
}

function buildGpuDatacenterAvailability(
  rawGpuTypes: any[]
): Record<string, DatacenterAvailabilityEntry[]> {
  const map: Record<string, DatacenterAvailabilityEntry[]> = {};
  for (const gpu of rawGpuTypes) {
    const gpuId = gpu.id ?? gpu.gpuTypeId;
    if (!gpuId) continue;
    const dcs = gpu.nodeGroupDatacenters ?? [];
    const entries: DatacenterAvailabilityEntry[] = [];
    for (const dc of dcs) {
      const list = dc.gpuAvailability;
      if (!Array.isArray(list)) continue;
      const entry = list.find((e: any) => e.gpuTypeId === gpuId);
      if (!entry) continue;
      entries.push({
        datacenterId: dc.id ?? '',
        datacenterName: dc.name ?? dc.location ?? '',
        location: dc.location ?? '',
        stockStatus: entry.stockStatus ?? null,
      });
    }
    if (entries.length > 0) map[gpuId] = entries;
  }
  return map;
}

/** Strip nodeGroupDatacenters and attach pre-computed availability so we don't send huge payload to client. */
function slimGpuTypesWithAvailability(rawGpuTypes: any[]): any[] {
  return rawGpuTypes.map((gpu: any) => {
    const gpuId = gpu.id ?? gpu.gpuTypeId;
    const availability = gpuId
      ? computeAvailabilitySummary(gpuId, gpu.nodeGroupDatacenters ?? [])
      : null;
    const { nodeGroupDatacenters: _dc, ...slim } = gpu;
    return { ...slim, availability: availability ?? undefined };
  });
}

const GPU_AVAILABILITY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let gpuAvailabilityCache: {
  apiKeyHash: string;
  data: {
    gpuTypes: any[];
    datacenters: any[];
    gpuDatacenterAvailability: Record<string, DatacenterAvailabilityEntry[]>;
  };
  fetchedAt: number;
} | null = null;

function hashApiKey(apiKey: string): string {
  let h = 0;
  for (let i = 0; i < Math.min(apiKey.length, 32); i++)
    h = (h << 5) - h + apiKey.charCodeAt(i);
  return String(h >>> 0);
}

export async function getGpuAvailability(config: RunPodConfig): Promise<{
  success: boolean;
  data?: {
    gpuTypes: any[];
    datacenters: any[];
    gpuDatacenterAvailability: Record<string, DatacenterAvailabilityEntry[]>;
  };
  error?: string;
}> {
  const { apiKey } = config;
  if (!apiKey?.trim()) return { success: false, error: 'API key is required' };
  const keyHash = hashApiKey(apiKey);
  if (
    gpuAvailabilityCache &&
    gpuAvailabilityCache.apiKeyHash === keyHash &&
    Date.now() - gpuAvailabilityCache.fetchedAt < GPU_AVAILABILITY_CACHE_TTL_MS
  ) {
    return { success: true, data: gpuAvailabilityCache.data };
  }
  try {
    const res = await runpodFetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      apiKey,
      body: JSON.stringify({ query: GET_GPU_TYPES_QUERY }),
    });
    const result = (await res.json()) as any;
    if (process.env.LOG_RUNPOD_GPU_RESPONSE === '1') {
      log.debug('GPU types response', JSON.stringify(result, null, 2));
    }
    const rawGpuTypes = result.data?.gpuTypes ?? [];
    const gpuTypes = slimGpuTypesWithAvailability(rawGpuTypes);
    const gpuDatacenterAvailability =
      buildGpuDatacenterAvailability(rawGpuTypes);
    let datacenters: any[] = [];
    try {
      const dcRes = await runpodFetch(GRAPHQL_ENDPOINT, {
        method: 'POST',
        apiKey,
        body: JSON.stringify({ query: GET_DATACENTERS_QUERY }),
      });
      const dcResult = (await dcRes.json()) as any;
      if (!dcResult.errors && dcResult.data?.dataCenters) {
        datacenters = dcResult.data.dataCenters;
      }
    } catch {
      // ignore
    }
    const data = { gpuTypes, datacenters, gpuDatacenterAvailability };
    gpuAvailabilityCache = { apiKeyHash: keyHash, data, fetchedAt: Date.now() };
    return { success: true, data };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function checkProxyHealth(
  podId: string,
  port = 8000
): Promise<{ success: boolean; isReady?: boolean; error?: string }> {
  const url = `https://${podId}-${port}.proxy.runpod.net/health`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
      });
      clearTimeout(timeoutId);
      return { success: true, isReady: res.ok };
    } catch (fetchErr: any) {
      clearTimeout(timeoutId);
      return { success: true, isReady: false };
    }
  } catch (e) {
    return { success: false, error: (e as Error).message, isReady: false };
  }
}

/** Check OpenAI-compatible API at /v1 (e.g. GET /v1/models). Use for connectivity status in Chat. */
export async function checkRunpodV1Connectivity(
  podId: string,
  port = 8000
): Promise<{ success: boolean; reachable?: boolean; error?: string }> {
  const url = `https://${podId}-${port}.proxy.runpod.net/v1/models`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
      });
      clearTimeout(timeoutId);
      return { success: true, reachable: res.ok };
    } catch (fetchErr: any) {
      clearTimeout(timeoutId);
      return { success: true, reachable: false };
    }
  } catch (e) {
    return { success: false, error: (e as Error).message, reachable: false };
  }
}

/** List models from pod's OpenAI-compatible /v1/models. For Chat model dropdown. */
export async function getRunpodModels(
  podId: string,
  port = 8000
): Promise<{
  success: boolean;
  models?: Array<{ id: string }>;
  error?: string;
}> {
  const url = `https://${podId}-${port}.proxy.runpod.net/v1/models`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
    });
    clearTimeout(timeoutId);
    if (!res.ok) return { success: true, models: [] };
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    const models = (data.data ?? [])
      .map((m) => ({ id: m.id ?? '' }))
      .filter((m) => m.id);
    return { success: true, models };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
