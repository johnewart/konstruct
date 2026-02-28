/**
 * Helpers for RunPod vLLM create flow - ported from runpod-desktop-app.
 */

/** Round context length down to a multiple of N (for tensor parallel; N = number of GPUs). */
export function contextLenForGpuCount(
  value: number,
  gpuCount: number,
  minLen = 512
): number {
  if (gpuCount <= 1) return value;
  return Math.max(minLen, Math.floor(value / gpuCount) * gpuCount);
}

/** Strip --tensor-parallel-size and its value from vLLM args so we can inject from UI. */
export function stripTensorParallelFromArgs(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tensor-parallel-size') {
      i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

/** Flatten nested file tree from HuggingFace API. */
export function flattenFileTree(
  tree: unknown,
  pathPrefix = ''
): { path: string; size: number }[] {
  if (!tree) return [];
  const files: { path: string; size: number }[] = [];
  const arr = Array.isArray(tree)
    ? tree
    : (tree as { children?: unknown[] })?.children;
  if (Array.isArray(arr)) {
    for (const item of arr as {
      type?: string;
      path?: string;
      size?: number;
      children?: unknown[];
    }[]) {
      if (item.type === 'file') {
        files.push({
          path: pathPrefix + (item.path ?? ''),
          size: item.size ?? 0,
        });
      } else if (item.type === 'directory' && item.children) {
        files.push(
          ...flattenFileTree(
            item.children,
            pathPrefix + (item.path ?? '') + '/'
          )
        );
      }
    }
  } else if (
    tree &&
    typeof tree === 'object' &&
    'children' in tree &&
    Array.isArray((tree as { children: unknown[] }).children)
  ) {
    files.push(
      ...flattenFileTree((tree as { children: unknown[] }).children, pathPrefix)
    );
  }
  return files;
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(2) + ' MB';
  return (bytes / 1024).toFixed(1) + ' KB';
}

/** Extract quantization label from GGUF path. */
export function getGgufQuantizationLabel(path: string): string {
  const base = path.split('/').pop() ?? path;
  const stem = base.replace(/\.gguf$/i, '');
  const match = stem.match(/(UD-Q[\w_]+|Q\d[\w_]+|F16|MXFP[\w_]+)$/);
  return match ? match[1] : stem;
}

export function estimateMinContainerDisk(
  metadata: {
    files?: unknown;
  } | null
): number | null {
  if (!metadata?.files) return null;
  const allFiles = flattenFileTree(metadata.files);
  const tensorFiles = allFiles.filter((f) => {
    const name = f.path ?? '';
    return name.endsWith('.safetensors') || name.endsWith('.bin');
  });
  if (tensorFiles.length === 0) return null;
  const totalBytes = tensorFiles.reduce((s, f) => s + (f.size ?? 0), 0);
  if (totalBytes <= 0) return null;
  const modelSizeGb = totalBytes / 1024 ** 3;
  return Math.ceil(modelSizeGb * 1.25);
}

export function estimateMinGpuMemory(
  metadata: {
    files?: unknown;
    model?: { tags?: string[] };
  } | null
): number | null {
  if (!metadata) return null;
  if (metadata.files) {
    const allFiles = flattenFileTree(metadata.files);
    const tensorFiles = allFiles.filter((f) => {
      const name = f.path ?? '';
      return name.endsWith('.safetensors') || name.endsWith('.bin');
    });
    if (tensorFiles.length > 0) {
      const totalBytes = tensorFiles.reduce((s, f) => s + (f.size ?? 0), 0);
      if (totalBytes > 0) {
        const modelSizeGb = totalBytes / 1024 ** 3;
        return Math.ceil(modelSizeGb * 1.25);
      }
    }
  }
  const tags = metadata.model?.tags ?? [];
  const memoryTag = tags.find(
    (t: string) => t.includes('gb') || t.includes('memory')
  );
  if (memoryTag) {
    const m = memoryTag.match(/(\d+)\s*gb/i);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

/** Generate vLLM args from model config (architecture-aware). */
export function generateVllmArgsFromArchitecture(
  extractedInfo: {
    modelType?: string;
    torchDtype?: string;
    numAttentionHeads?: number;
    ropeScaling?: unknown;
    quantizationConfig?: { quant_method?: string };
  },
  numGpus: number
): string | null {
  if (!extractedInfo.modelType) return null;
  const args: string[] = [];
  const modelType = (extractedInfo.modelType ?? '').toLowerCase();

  if (extractedInfo.torchDtype) {
    const dtype = extractedInfo.torchDtype.toLowerCase();
    if (dtype.includes('float16') || dtype.includes('half'))
      args.push('--dtype', 'half');
    else if (dtype.includes('bfloat16')) args.push('--dtype', 'bfloat16');
    else if (dtype.includes('float32')) args.push('--dtype', 'float');
  } else {
    if (
      modelType.includes('llama') ||
      modelType.includes('mistral') ||
      modelType.includes('qwen')
    ) {
      args.push('--dtype', 'bfloat16');
    } else {
      args.push('--dtype', 'half');
    }
  }

  if (extractedInfo.numAttentionHeads && numGpus > 1) {
    let suggestedTp = 1;
    if (numGpus >= 8 && extractedInfo.numAttentionHeads % 8 === 0)
      suggestedTp = 8;
    else if (numGpus >= 4 && extractedInfo.numAttentionHeads % 4 === 0)
      suggestedTp = 4;
    else if (numGpus >= 2 && extractedInfo.numAttentionHeads % 2 === 0)
      suggestedTp = 2;
    if (suggestedTp > 1)
      args.push('--tensor-parallel-size', suggestedTp.toString());
  }

  if (modelType.includes('llama') && extractedInfo.ropeScaling)
    args.push('--trust-remote-code');
  else if (modelType.includes('qwen')) args.push('--trust-remote-code');
  else if (modelType.includes('mixtral')) args.push('--trust-remote-code');
  else if (modelType.includes('phi') || modelType.includes('gemma'))
    args.push('--trust-remote-code');

  const quantMethod =
    extractedInfo.quantizationConfig?.quant_method?.toLowerCase();
  if (quantMethod === 'awq') args.push('--quantization', 'awq');
  else if (quantMethod === 'gptq') args.push('--quantization', 'gptq');
  else if (quantMethod === 'squeezellm')
    args.push('--quantization', 'squeezellm');

  return args.length > 0 ? args.join(' ') : null;
}

export type GpuAvailabilitySummary = {
  availableRegions: number;
  stockStatus: string | null;
};

export type GpuSuitableItem = {
  gpu: {
    id?: string;
    gpuTypeId?: string;
    displayName?: string;
    name?: string;
    memoryInGb?: number;
    secureCloud?: boolean;
    communityCloud?: boolean;
  };
  status: 'good' | 'close' | 'needs2';
  needs2: boolean;
  pricePerHour?: number;
  availability?: GpuAvailabilitySummary | null;
};

/** Availability is computed on the server and attached to each GPU. Use it when present. */
function getGpuAvailability(
  gpu: Record<string, unknown>
): GpuAvailabilitySummary | null {
  const av = gpu.availability as GpuAvailabilitySummary | undefined;
  if (av && typeof av.availableRegions === 'number') return av;
  return null;
}

/** Get availability summary for a saved template's GPU type(s). Uses first gpuTypeId in podConfig. */
export function getTemplateGpuAvailability(
  gpuAvailability: { gpuTypes?: unknown[] } | null,
  template: { podConfig?: Record<string, unknown> }
): GpuAvailabilitySummary | null {
  const gpuTypeIds = template.podConfig?.gpuTypeIds as string[] | undefined;
  const id =
    Array.isArray(gpuTypeIds) && gpuTypeIds.length > 0
      ? gpuTypeIds[0]
      : undefined;
  if (!id || !gpuAvailability?.gpuTypes?.length) return null;
  const gpu = (gpuAvailability.gpuTypes as Record<string, unknown>[]).find(
    (g) => (g.id ?? (g as { gpuTypeId?: string }).gpuTypeId) === id
  );
  return gpu ? getGpuAvailability(gpu) : null;
}

/** Filter GPUs by required VRAM; return suitable (with status) and filtered-out. */
export function getFilteredGpus(
  gpuAvailability: { gpuTypes?: unknown[] } | null,
  effectiveMinGpuMemoryGb: number | null
): { suitable: GpuSuitableItem[]; filtered: unknown[] } {
  const gpuTypes =
    gpuAvailability?.gpuTypes ??
    (Array.isArray(gpuAvailability) ? (gpuAvailability as unknown[]) : []);
  if (!effectiveMinGpuMemoryGb) {
    return {
      suitable: (gpuTypes as Record<string, unknown>[]).map((gpu) => ({
        gpu,
        status: 'good' as const,
        needs2: false,
        pricePerHour:
          (
            gpu as {
              securePrice?: number;
              communityPrice?: number;
              lowestPrice?: {
                minimumBidPrice?: number;
                uninterruptablePrice?: number;
              };
            }
          ).securePrice ??
          (
            gpu as {
              lowestPrice?: {
                uninterruptablePrice?: number;
                minimumBidPrice?: number;
              };
            }
          ).lowestPrice?.uninterruptablePrice,
        availability: getGpuAvailability(gpu) ?? undefined,
      })),
      filtered: [],
    };
  }
  const suitable: GpuSuitableItem[] = [];
  const filtered: unknown[] = [];
  const minFor2 = effectiveMinGpuMemoryGb * 0.6;

  for (const gpu of gpuTypes as (Record<string, unknown> & {
    memoryInGb?: number;
  })[]) {
    const mem = gpu.memoryInGb;
    if (mem == null) {
      filtered.push(gpu);
      continue;
    }
    const pricePerHour = gpu.communityCloud
      ? ((gpu.communityPrice ??
          (gpu.lowestPrice as { minimumBidPrice?: number })
            ?.minimumBidPrice) as number | undefined)
      : ((gpu.securePrice ??
          (
            gpu.lowestPrice as {
              uninterruptablePrice?: number;
              minimumBidPrice?: number;
            }
          )?.uninterruptablePrice ??
          (gpu.lowestPrice as { minimumBidPrice?: number })
            ?.minimumBidPrice) as number | undefined);

    const availability = getGpuAvailability(gpu) ?? undefined;
    if (mem >= effectiveMinGpuMemoryGb) {
      const headroom = mem - effectiveMinGpuMemoryGb;
      const status =
        (headroom / effectiveMinGpuMemoryGb) * 100 > 20 ? 'good' : 'close';
      suitable.push({ gpu, status, needs2: false, pricePerHour, availability });
    } else if (mem >= minFor2) {
      suitable.push({
        gpu,
        status: 'needs2',
        needs2: true,
        pricePerHour,
        availability,
      });
    } else {
      filtered.push(gpu);
    }
  }

  suitable.sort((a, b) => {
    const order = { good: 0, close: 1, needs2: 2 };
    if (order[a.status] !== order[b.status])
      return order[a.status] - order[b.status];
    return (b.gpu.memoryInGb ?? 0) - (a.gpu.memoryInGb ?? 0);
  });
  return { suitable, filtered };
}
