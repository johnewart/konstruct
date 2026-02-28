import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { trpc } from '../trpc';
import {
  Paper,
  Stack,
  TextInput,
  Textarea,
  PasswordInput,
  Button,
  Alert,
  Group,
  Badge,
  Text,
  ActionIcon,
  Tooltip,
  Modal,
  Select,
  NumberInput,
  Box,
  Divider,
  Card,
  ThemeIcon,
  Slider,
  Loader,
  Grid,
  Accordion,
  UnstyledButton,
  Menu,
  Switch,
  Table,
  ScrollArea,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import {
  IconRefresh,
  IconPlayerPlay,
  IconPlayerStop,
  IconTrash,
  IconExternalLink,
  IconPlus,
  IconLogout,
  IconCopy,
  IconAlertCircle,
  IconKey,
  IconStar,
  IconStarFilled,
  IconPin,
  IconPinFilled,
} from '@tabler/icons-react';
import {
  contextLenForGpuCount,
  stripTensorParallelFromArgs,
  flattenFileTree,
  formatFileSize,
  getGgufQuantizationLabel,
  estimateMinContainerDisk,
  estimateMinGpuMemory,
  generateVllmArgsFromArchitecture,
  getFilteredGpus,
  getTemplateGpuAvailability,
} from '../lib/runpodCreate';

const RUNPOD_CONFIG_KEY = 'runpod-config';
const RUNPOD_BOOKMARKS_KEY = 'runpod-bookmarked-models';
const RUNPOD_MODEL_SETTINGS_KEY = 'runpod-model-settings';
const RUNPOD_VLLM_ARGS_KEY = 'runpod-model-vllm-args';
const DEFAULT_ENDPOINT = 'https://rest.runpod.io/v1';
const VLLM_IMAGE_DEFAULT = 'vllm/vllm-openai:latest';

type RunpodModelSettings = {
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

const TOOL_PARSER_OPTIONS = [
  { value: '', label: 'Auto' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'hermes', label: 'Hermes' },
  { value: 'llama', label: 'Llama' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'qwen3_coder', label: 'Qwen3 Coder' },
];

const DTYPE_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'bfloat16', label: 'bfloat16' },
  { value: 'float16', label: 'float16' },
  { value: 'float32', label: 'float32' },
];

function slugify(s: string): string {
  if (s == null || typeof s !== 'string') return '';
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

type Pod = {
  id: string;
  name: string;
  status: string;
  gpuCount: number;
  uptimeSeconds?: number;
  lastStartedAt?: string;
  costPerHour?: number;
  memoryGb?: number;
  containerDiskGb?: number;
  vcpuCount?: number;
  imageName?: string;
  /** When RUNNING, true if proxy /health returned OK. */
  proxyReady?: boolean;
  machine?: { gpuName: string; gpuCount: number; gpuMemoryGb?: number };
  resources?: { cpu?: number; memory?: number; gpu?: number };
};

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function getStatusColor(status: string): string {
  const u = (status || '').toUpperCase();
  if (u === 'RUNNING') return 'green';
  if (u === 'STOPPED' || u === 'EXITED' || u === 'IDLE') return 'gray';
  return 'yellow';
}

/** GPU compatibility dot color: good = green, close = orange, needs2 = yellow */
function gpuStatusDotColor(status: 'good' | 'close' | 'needs2'): string {
  switch (status) {
    case 'good':
      return 'var(--mantine-color-green-6)';
    case 'close':
      return 'var(--mantine-color-orange-6)';
    case 'needs2':
      return 'var(--mantine-color-yellow-6)';
    default:
      return 'var(--mantine-color-gray-5)';
  }
}

export function RunPodPage() {
  const [configSaved, setConfigSaved] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT);
  const [pods, setPods] = useState<Pod[]>([]);
  const [billingInfo, setBillingInfo] = useState<{
    credits?: number | null;
    currentSpendPerHr?: number | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [hfTokenModalOpen, setHfTokenModalOpen] = useState(false);
  const [hfTokenEditValue, setHfTokenEditValue] = useState('');
  const [gpuAvailability, setGpuAvailability] = useState<{
    gpuTypes?: unknown[];
    datacenters?: unknown[];
    gpuDatacenterAvailability?: Record<
      string,
      Array<{
        datacenterId: string;
        datacenterName: string;
        location: string;
        stockStatus: string | null;
      }>
    >;
  } | null>(null);
  const [gpuLoading, setGpuLoading] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [vllmModel, setVllmModel] = useState('');
  const [modelSearchResults, setModelSearchResults] = useState<
    {
      id: string;
      pipeline_tag?: string;
      downloads?: number;
      isBookmarked?: boolean;
      isBookmarkedOnly?: boolean;
    }[]
  >([]);
  const [showModelSearchResults, setShowModelSearchResults] = useState(false);
  const [modelSearchLoading, setModelSearchLoading] = useState(false);
  const [bookmarkedModels, setBookmarkedModels] = useState<Set<string>>(
    new Set()
  );
  const [bookmarksLoaded, setBookmarksLoaded] = useState(false);
  const lastSelectedModelRef = useRef('');
  const [selectedModelMetadata, setSelectedModelMetadata] = useState<{
    model?: unknown;
    files?: unknown;
    config?: { _extracted?: Record<string, unknown> };
  } | null>(null);
  const [modelMetadataLoading, setModelMetadataLoading] = useState(false);
  const [selectedGgufFile, setSelectedGgufFile] = useState<string | null>(null);
  const [modelVllmArgs, setModelVllmArgs] = useState<Record<string, string>>(
    {}
  );
  const [modelSettings, setModelSettings] = useState<
    Record<string, RunpodModelSettings>
  >({});
  const [vllmArgs, setVllmArgs] = useState('');
  const [suggestedVllmArgs, setSuggestedVllmArgs] = useState<string | null>(
    null
  );
  const [maxModelLen, setMaxModelLen] = useState(32768);
  const [maxContextWindowLimit, setMaxContextWindowLimit] = useState(256000);
  const [containerDiskInGb, setContainerDiskInGb] = useState(50);
  const [volumeInGb, setVolumeInGb] = useState(50);
  const [enableTools, setEnableTools] = useState(false);
  const [toolParser, setToolParser] = useState('');
  const [autoToolChoice, setAutoToolChoice] = useState(false);
  const [dtype, setDtype] = useState('auto');
  const [trustRemoteCode, setTrustRemoteCode] = useState(false);
  const [gpuMemoryUtilization, setGpuMemoryUtilization] = useState(93);
  const [seed, setSeed] = useState<number | ''>('');
  const [maxNumSeqs, setMaxNumSeqs] = useState<number | ''>(256);
  const [enforceEager, setEnforceEager] = useState(false);
  const [disableLogStats, setDisableLogStats] = useState(false);
  const [generationConfig, setGenerationConfig] = useState('');
  const [containerImage, setContainerImage] = useState(VLLM_IMAGE_DEFAULT);
  const [podName, setPodName] = useState('');
  const [gpuCount, setGpuCount] = useState(1);
  const [selectedGpu, setSelectedGpu] = useState('');
  const [selectedRegion, setSelectedRegion] = useState('');
  const [gpuDropdownOpen, setGpuDropdownOpen] = useState(false);
  const [isSelectingModel, setIsSelectingModel] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [userHasEditedTemplateName, setUserHasEditedTemplateName] =
    useState(false);
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(
    null
  );

  const config = { apiKey, endpoint };

  const checkConnection = trpc.runpod.checkConnection.useMutation();
  const getPodsMutation = trpc.runpod.getPods.useMutation();
  const getBillingMutation = trpc.runpod.getBilling.useMutation();
  const getGpuAvailabilityMutation =
    trpc.runpod.getGpuAvailability.useMutation();
  const startPodMutation = trpc.runpod.startPod.useMutation();
  const stopPodMutation = trpc.runpod.stopPod.useMutation();
  const deletePodMutation = trpc.runpod.deletePod.useMutation();
  const runpodModelSettingsQuery =
    trpc.runpod.getRunpodModelSettings.useQuery();
  const setRunpodModelSettingsMutation =
    trpc.runpod.setRunpodModelSettings.useMutation();
  const utils = trpc.useUtils();
  const runpodTemplatesQuery = trpc.runpod.getRunpodTemplates.useQuery();
  const saveRunpodTemplateMutation = trpc.runpod.saveRunpodTemplate.useMutation(
    {
      onSuccess: () => {
        utils.runpod.getRunpodTemplates.invalidate();
        setCreateModalOpen(false);
        setTemplateName('');
      },
      onError: (err) => setError(err.message),
    }
  );
  const launchRunpodTemplateMutation =
    trpc.runpod.launchRunpodTemplate.useMutation({
      onSuccess: (result) => {
        if (!result.success) setError(result.error ?? 'Failed to start');
        else {
          utils.runpod.getRunpodTemplates.invalidate();
          loadPods();
          loadBilling();
        }
      },
      onError: (err) => setError(err.message),
      onSettled: () => setPendingTemplateId(null),
    });
  const stopRunpodTemplateMutation = trpc.runpod.stopRunpodTemplate.useMutation(
    {
      onSuccess: (result) => {
        if (!result.success) setError(result.error ?? 'Failed to stop');
        else {
          utils.runpod.getRunpodTemplates.invalidate();
          loadPods();
          loadBilling();
        }
      },
      onError: (err) => setError(err.message),
      onSettled: () => setPendingTemplateId(null),
    }
  );
  const deleteRunpodTemplateMutation =
    trpc.runpod.deleteRunpodTemplate.useMutation({
      onSuccess: () => utils.runpod.getRunpodTemplates.invalidate(),
    });
  const { data: defaultPodData } = trpc.runpod.getDefaultRunpodPod.useQuery();
  const setDefaultPodMutation = trpc.runpod.setDefaultRunpodPod.useMutation({
    onSuccess: () => utils.runpod.getDefaultRunpodPod.invalidate(),
  });

  const configForm = useForm({
    initialValues: { apiKey: '', endpoint: DEFAULT_ENDPOINT, hfToken: '' },
    validate: { apiKey: (v) => (!v?.trim() ? 'API key is required' : null) },
  });

  // Load saved config from localStorage
  useEffect(() => {
    const raw = localStorage.getItem(RUNPOD_CONFIG_KEY);
    if (raw) {
      try {
        const c = JSON.parse(raw);
        const key = c.apiKey ?? '';
        const ep = c.endpoint ?? DEFAULT_ENDPOINT;
        const hf = c.hfToken ?? '';
        setApiKey(key);
        setEndpoint(ep);
        setConfigSaved(!!key);
        configForm.setValues({ apiKey: key, endpoint: ep, hfToken: hf });
      } catch {
        // ignore
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveConnection = useCallback(async () => {
    const values = configForm.values;
    if (!values.apiKey?.trim()) {
      configForm.setFieldError('apiKey', 'API key is required');
      return;
    }
    setError(null);
    const cfg = {
      apiKey: values.apiKey.trim(),
      endpoint: values.endpoint?.trim() || DEFAULT_ENDPOINT,
      hfToken: values.hfToken?.trim() || '',
    };
    const result = await checkConnection.mutateAsync(cfg);
    if (!result.success) {
      setError(result.error ?? 'Failed to connect');
      return;
    }
    localStorage.setItem(RUNPOD_CONFIG_KEY, JSON.stringify(cfg));
    setApiKey(cfg.apiKey);
    setEndpoint(cfg.endpoint);
    setConfigSaved(true);
  }, [configForm, checkConnection]);

  const loadPods = useCallback(async () => {
    if (!configSaved || !apiKey) return;
    setError(null);
    const result = await getPodsMutation.mutateAsync(config);
    if (result.success && result.pods) setPods(result.pods);
    else if (!result.success) setError(result.error ?? 'Failed to load pods');
  }, [configSaved, apiKey, config, getPodsMutation]);

  const loadBilling = useCallback(async () => {
    if (!configSaved || !apiKey) return;
    const result = await getBillingMutation.mutateAsync(config);
    if (result.success && result.data) setBillingInfo(result.data);
  }, [configSaved, apiKey, config, getBillingMutation]);

  const loadGpuAvailability = useCallback(async () => {
    if (!configSaved || !apiKey) return;
    setGpuLoading(true);
    try {
      const result = await getGpuAvailabilityMutation.mutateAsync(config);
      if (result.success && result.data) {
        setGpuAvailability({
          gpuTypes: result.data.gpuTypes ?? [],
          datacenters: result.data.datacenters ?? [],
          gpuDatacenterAvailability:
            result.data.gpuDatacenterAvailability ?? {},
        });
      }
    } finally {
      setGpuLoading(false);
    }
  }, [configSaved, apiKey, config, getGpuAvailabilityMutation]);

  const initialLoadDoneRef = useRef(false);
  useEffect(() => {
    if (!configSaved || !apiKey) {
      initialLoadDoneRef.current = false;
      return;
    }
    if (initialLoadDoneRef.current) return;
    initialLoadDoneRef.current = true;
    loadPods();
    loadBilling();
    loadGpuAvailability();
  }, [configSaved, apiKey, loadPods, loadBilling, loadGpuAvailability]);

  useEffect(() => {
    if (!configSaved || pods.length === 0) return;
    const t = setInterval(() => {
      loadPods();
      loadBilling();
    }, 30000);
    return () => clearInterval(t);
  }, [configSaved, pods.length, loadPods, loadBilling]);

  const getFilteredBookmarkedModels = useCallback(
    (query: string) => {
      const arr = Array.from(bookmarkedModels);
      if (!query?.trim())
        return arr.map((id) => ({
          id,
          isBookmarked: true,
          isBookmarkedOnly: true,
        }));
      const q = query.toLowerCase();
      return arr
        .filter((id) => id.toLowerCase().includes(q))
        .map((id) => ({ id, isBookmarked: true, isBookmarkedOnly: true }));
    },
    [bookmarkedModels]
  );

  const searchHuggingFaceModels = useCallback(
    async (query: string) => {
      const filtered = getFilteredBookmarkedModels(query);
      if (!query || query.length < 2) {
        setModelSearchResults(filtered);
        setShowModelSearchResults(filtered.length > 0);
        return;
      }
      setModelSearchLoading(true);
      try {
        const res = await fetch(
          `https://huggingface.co/api/models?search=${encodeURIComponent(query)}&limit=10&sort=downloads`
        );
        if (res.ok) {
          const data = (await res.json()) as {
            id?: string;
            pipeline_tag?: string;
            downloads?: number;
          }[];
          const withBookmarks = (data ?? []).map((m) => ({
            ...m,
            id: m.id ?? '',
            isBookmarked: bookmarkedModels.has(m.id ?? ''),
            isBookmarkedOnly: false,
          }));
          const bookmarkIds = new Set(filtered.map((b) => b.id));
          const combined = [
            ...filtered,
            ...withBookmarks.filter((m) => !bookmarkIds.has(m.id)),
          ];
          setModelSearchResults(combined);
          setShowModelSearchResults(true);
        } else {
          setModelSearchResults(filtered);
          setShowModelSearchResults(filtered.length > 0);
        }
      } catch {
        setModelSearchResults(filtered);
        setShowModelSearchResults(filtered.length > 0);
      } finally {
        setModelSearchLoading(false);
      }
    },
    [bookmarkedModels, getFilteredBookmarkedModels]
  );

  const fetchModelMetadata = useCallback(
    async (modelId: string) => {
      if (!modelId) {
        setSelectedModelMetadata(null);
        setMaxContextWindowLimit(256000);
        return;
      }
      setModelMetadataLoading(true);
      try {
        const [modelRes, filesRes, configRes] = await Promise.allSettled([
          fetch(`https://huggingface.co/api/models/${modelId}`),
          fetch(`https://huggingface.co/api/models/${modelId}/tree/main`).catch(
            () => null
          ),
          fetch(`https://huggingface.co/${modelId}/raw/main/config.json`).catch(
            () => null
          ),
        ]);
        let modelData = null;
        let filesData = null;
        let configData: Record<string, unknown> | null = null;
        if (modelRes.status === 'fulfilled' && modelRes.value.ok)
          modelData = await modelRes.value.json();
        if (filesRes.status === 'fulfilled' && filesRes.value?.ok)
          filesData = await filesRes.value.json();
        if (configRes.status === 'fulfilled' && configRes.value?.ok) {
          try {
            configData = (await configRes.value.json()) as Record<
              string,
              unknown
            >;
            const maxCtx =
              (configData?.max_position_embeddings as number) ??
              (configData?.max_seq_len as number) ??
              (configData?.model_max_length as number) ??
              ((configData?.text_config as Record<string, unknown>)
                ?.max_position_embeddings as number);
            const maxCtxNum = typeof maxCtx === 'number' ? maxCtx : null;
            if (maxCtxNum != null) {
              setMaxContextWindowLimit(maxCtxNum);
              const saved = modelSettings[vllmModel];
              if (!saved?.maxModelLen) setMaxModelLen(maxCtxNum);
            } else {
              setMaxContextWindowLimit(256000);
              const saved = modelSettings[vllmModel];
              if (!saved?.maxModelLen) setMaxModelLen(32768);
            }
            const extracted: Record<string, unknown> = {
              modelType:
                (configData?.model_type as string) ??
                (configData?.architectures as string[])?.[0],
              maxContextWindow: maxCtxNum,
              hiddenSize:
                (configData?.hidden_size as number) ??
                (configData?.text_config as Record<string, unknown>)
                  ?.hidden_size,
              numLayers:
                (configData?.num_hidden_layers as number) ??
                (configData?.text_config as Record<string, unknown>)
                  ?.num_hidden_layers,
              numAttentionHeads:
                (configData?.num_attention_heads as number) ??
                (configData?.text_config as Record<string, unknown>)
                  ?.num_attention_heads,
              numKeyValueHeads:
                (configData?.num_key_value_heads as number) ??
                (configData?.text_config as Record<string, unknown>)
                  ?.num_key_value_heads,
              torchDtype: configData?.torch_dtype,
              ropeScaling: configData?.rope_scaling,
              quantizationConfig: configData?.quantization_config,
            };
            (configData as Record<string, unknown>)._extracted = extracted;
          } catch {
            setMaxContextWindowLimit(256000);
          }
        }
        setSelectedModelMetadata({
          model: modelData,
          files: filesData,
          config: configData,
        });
        if (configData?._extracted) {
          const suggested = generateVllmArgsFromArchitecture(
            configData._extracted as Parameters<
              typeof generateVllmArgsFromArchitecture
            >[0],
            gpuCount
          );
          setSuggestedVllmArgs(suggested);
        } else setSuggestedVllmArgs(null);
      } catch {
        setSelectedModelMetadata(null);
        setMaxContextWindowLimit(256000);
      } finally {
        setModelMetadataLoading(false);
      }
    },
    [vllmModel, gpuCount, modelSettings]
  );

  const toggleBookmark = useCallback((modelId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setBookmarkedModels((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RUNPOD_BOOKMARKS_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        if (Array.isArray(arr)) setBookmarkedModels(new Set(arr));
      }
      setBookmarksLoaded(true);
    } catch {
      setBookmarksLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!bookmarksLoaded) return;
    try {
      localStorage.setItem(
        RUNPOD_BOOKMARKS_KEY,
        JSON.stringify(Array.from(bookmarkedModels))
      );
    } catch {
      // ignore
    }
  }, [bookmarkedModels, bookmarksLoaded]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RUNPOD_MODEL_SETTINGS_KEY);
      if (raw) setModelSettings(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const server = runpodModelSettingsQuery.data;
    if (server && typeof server === 'object') {
      setModelSettings((prev) => {
        const next = { ...prev };
        for (const [modelId, s] of Object.entries(server)) {
          if (s && typeof s === 'object')
            next[modelId] = { ...prev[modelId], ...s };
        }
        return next;
      });
    }
  }, [runpodModelSettingsQuery.data]);

  useEffect(() => {
    try {
      localStorage.setItem(
        RUNPOD_MODEL_SETTINGS_KEY,
        JSON.stringify(modelSettings)
      );
    } catch {
      // ignore
    }
  }, [modelSettings]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(RUNPOD_VLLM_ARGS_KEY);
      if (raw) setModelVllmArgs(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  const ggufFiles = useMemo(() => {
    if (!selectedModelMetadata?.files) return [];
    const all = flattenFileTree(selectedModelMetadata.files);
    return all
      .filter((f) => (f.path ?? '').toLowerCase().endsWith('.gguf'))
      .map((f) => ({
        path: f.path,
        size: f.size ?? 0,
        label: `${getGgufQuantizationLabel(f.path)} (${formatFileSize(f.size ?? 0)})`,
      }))
      .sort((a, b) => b.size - a.size);
  }, [selectedModelMetadata]);

  const selectedGgufFileSizeBytes = useMemo(() => {
    if (!selectedGgufFile || ggufFiles.length === 0) return null;
    const f = ggufFiles.find((x) => x.path === selectedGgufFile);
    return f ? f.size : null;
  }, [selectedGgufFile, ggufFiles]);

  const effectiveMinGpuMemoryGb = useMemo(() => {
    if (selectedGgufFileSizeBytes != null) {
      return Math.ceil((selectedGgufFileSizeBytes / 1024 ** 3) * 1.25);
    }
    return selectedModelMetadata
      ? estimateMinGpuMemory(selectedModelMetadata)
      : null;
  }, [selectedGgufFileSizeBytes, selectedModelMetadata]);

  const effectiveMinContainerDiskGb = useMemo(() => {
    if (selectedGgufFileSizeBytes != null) {
      return Math.ceil((selectedGgufFileSizeBytes / 1024 ** 3) * 1.25);
    }
    return selectedModelMetadata
      ? estimateMinContainerDisk(selectedModelMetadata)
      : null;
  }, [selectedGgufFileSizeBytes, selectedModelMetadata]);

  const { suitable: suitableGpus } = useMemo(
    () => getFilteredGpus(gpuAvailability, effectiveMinGpuMemoryGb),
    [gpuAvailability, effectiveMinGpuMemoryGb]
  );

  const POD_NAME_PREFIX = 'vllm-openai';

  const autoGeneratedConfigName = useMemo(() => {
    try {
      const modelPart = vllmModel?.trim()
        ? slugify(String(vllmModel).replace(/\//g, '-'))
        : '';
      const list = Array.isArray(suitableGpus) ? suitableGpus : [];
      const gpuItem = list.find(
        (s) =>
          (s?.gpu?.id ?? (s?.gpu as { gpuTypeId?: string })?.gpuTypeId) ===
          selectedGpu
      );
      const gpuPart = gpuItem
        ? slugify(
            String(
              gpuItem.gpu?.displayName ??
                gpuItem.gpu?.name ??
                gpuItem.gpu?.id ??
                selectedGpu ??
                ''
            )
          )
        : selectedGpu
          ? slugify(String(selectedGpu))
          : '';
      const regionPart = selectedRegion?.trim()
        ? slugify(String(selectedRegion))
        : 'auto';
      const parts = [modelPart, gpuPart, regionPart].filter(Boolean);
      const suffix = parts.length > 0 ? parts.join('-') : 'auto';
      return `${POD_NAME_PREFIX}-${suffix}`;
    } catch {
      return `${POD_NAME_PREFIX}-auto`;
    }
  }, [vllmModel, selectedGpu, selectedRegion, suitableGpus]);

  useEffect(() => {
    if (!userHasEditedTemplateName && autoGeneratedConfigName) {
      setTemplateName(autoGeneratedConfigName);
    }
  }, [userHasEditedTemplateName, autoGeneratedConfigName]);

  useEffect(() => {
    if (!createModalOpen) {
      setUserHasEditedTemplateName(false);
      setTemplateName('');
    }
  }, [createModalOpen]);

  const vllmCommandPreview = useMemo(() => {
    const parts: string[] = [];
    const modelName =
      vllmModel && selectedGgufFile
        ? `${vllmModel}:${getGgufQuantizationLabel(selectedGgufFile)}`
        : vllmModel || '<model>';
    parts.push(modelName);
    parts.push('--host', '0.0.0.0', '--port', '8000');
    const gpuMem = (gpuMemoryUtilization ?? 93) / 100;
    parts.push('--gpu-memory-utilization', gpuMem.toFixed(2));
    const effMax = contextLenForGpuCount(maxModelLen, gpuCount);
    parts.push('--max-model-len', effMax.toString());
    if (dtype && dtype !== 'auto') parts.push('--dtype', dtype);
    if (trustRemoteCode) parts.push('--trust-remote-code');
    if (typeof seed === 'number') parts.push('--seed', seed.toString());
    if (enableTools) {
      parts.push('--enable-auto-tool-choice');
      if (toolParser?.trim())
        parts.push('--tool-call-parser', toolParser.trim());
    }
    if (enforceEager) parts.push('--enforce-eager');
    if (disableLogStats) parts.push('--disable-log-stats');
    if (generationConfig?.trim())
      parts.push('--generation-config', generationConfig.trim());
    if (gpuCount > 1) parts.push('--tensor-parallel-size', gpuCount.toString());
    if (vllmArgs?.trim()) {
      const userArgs = vllmArgs.trim().split(/\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/);
      parts.push(...stripTensorParallelFromArgs(userArgs));
    }
    return parts.join(' ');
  }, [
    vllmModel,
    selectedGgufFile,
    gpuMemoryUtilization,
    maxModelLen,
    gpuCount,
    dtype,
    trustRemoteCode,
    seed,
    enableTools,
    toolParser,
    enforceEager,
    disableLogStats,
    generationConfig,
    vllmArgs,
  ]);

  const saveVllmArgsForModel = useCallback((modelId: string, args: string) => {
    setModelVllmArgs((prev) => {
      const next = { ...prev, [modelId]: args };
      try {
        localStorage.setItem(RUNPOD_VLLM_ARGS_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const saveModelSettings = useCallback(
    (modelId: string, settings: Partial<RunpodModelSettings>) => {
      setModelSettings((prev) => ({
        ...prev,
        [modelId]: { ...prev[modelId], ...settings },
      }));
      setRunpodModelSettingsMutation.mutate({ modelId, settings });
    },
    [setRunpodModelSettingsMutation]
  );

  useEffect(() => {
    if (gpuCount > 1) {
      setMaxModelLen((prev) => {
        const rounded = contextLenForGpuCount(prev, gpuCount);
        return rounded === prev ? prev : rounded;
      });
    }
  }, [gpuCount]);

  const handleStartPod = async (podId: string) => {
    setError(null);
    const result = await startPodMutation.mutateAsync({ ...config, podId });
    if (result.success) loadPods();
    else setError(result.error ?? 'Failed to start pod');
  };

  const handleStopPod = async (podId: string) => {
    setError(null);
    const result = await stopPodMutation.mutateAsync({ ...config, podId });
    if (result.success) loadPods();
    else setError(result.error ?? 'Failed to stop pod');
  };

  const handleDeletePod = async (podId: string) => {
    if (!window.confirm('Delete this pod? This cannot be undone.')) return;
    setError(null);
    const result = await deletePodMutation.mutateAsync({ ...config, podId });
    if (result.success) {
      setPods((prev) => prev.filter((p) => p.id !== podId));
      loadBilling();
    } else setError(result.error ?? 'Failed to delete pod');
  };

  const getHfToken = () => {
    try {
      const raw = localStorage.getItem(RUNPOD_CONFIG_KEY);
      const c = raw ? JSON.parse(raw) : {};
      return (c.hfToken ?? '') as string;
    } catch {
      return '';
    }
  };

  const buildPodConfigFromForm = useCallback((): Record<
    string,
    unknown
  > | null => {
    if (!selectedGpu || !vllmModel) return null;
    const quantizationSuffix = selectedGgufFile
      ? getGgufQuantizationLabel(selectedGgufFile)
      : '';
    const effectiveModelName = quantizationSuffix
      ? `${vllmModel}:${quantizationSuffix}`
      : vllmModel;
    const envObj: Record<string, string> = { MODEL_NAME: effectiveModelName };
    if (selectedGgufFile) envObj.MODEL_FILE = selectedGgufFile;
    const hfToken = getHfToken();
    if (hfToken) envObj.HF_TOKEN = hfToken;

    const effectiveMaxModelLen = contextLenForGpuCount(maxModelLen, gpuCount);
    const gpuMem = (gpuMemoryUtilization ?? 93) / 100;
    const dockerStartCmd: string[] = [
      effectiveModelName,
      '--host',
      '0.0.0.0',
      '--port',
      '8000',
      '--gpu-memory-utilization',
      gpuMem.toFixed(2),
      '--max-model-len',
      effectiveMaxModelLen.toString(),
    ];
    if (dtype && dtype !== 'auto') dockerStartCmd.push('--dtype', dtype);
    if (trustRemoteCode) dockerStartCmd.push('--trust-remote-code');
    if (typeof seed === 'number')
      dockerStartCmd.push('--seed', seed.toString());
    if (enableTools) {
      dockerStartCmd.push('--enable-auto-tool-choice');
      if (toolParser?.trim())
        dockerStartCmd.push('--tool-call-parser', toolParser.trim());
    }
    if (enforceEager) dockerStartCmd.push('--enforce-eager');
    if (disableLogStats) dockerStartCmd.push('--disable-log-stats');
    if (generationConfig?.trim())
      dockerStartCmd.push('--generation-config', generationConfig.trim());
    if (gpuCount > 1)
      dockerStartCmd.push('--tensor-parallel-size', gpuCount.toString());
    if (vllmArgs?.trim()) {
      const userArgs = vllmArgs.trim().split(/\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/);
      dockerStartCmd.push(...stripTensorParallelFromArgs(userArgs));
    }

    const selectedGpuData = suitableGpus.find(
      (s) =>
        (s.gpu.id ?? (s.gpu as { gpuTypeId?: string }).gpuTypeId) ===
        selectedGpu
    )?.gpu as { secureCloud?: boolean };
    const cloudType = selectedGpuData?.secureCloud ? 'SECURE' : 'COMMUNITY';

    const podConfig = {
      name: podName?.trim() || `vllm-${effectiveModelName.replace(/\//g, '-')}`,
      imageName: (containerImage?.trim() || VLLM_IMAGE_DEFAULT) as string,
      gpuTypeIds: [selectedGpu] as string[],
      gpuCount,
      cloudType,
      supportPublicIp: true,
      env: envObj,
      ports: ['8000/http'] as string[],
      volumeInGb,
      containerDiskInGb,
      dockerStartCmd,
    } as Record<string, unknown>;
    if (selectedRegion) podConfig.dataCenterId = selectedRegion;
    return podConfig;
  }, [
    selectedGpu,
    vllmModel,
    selectedGgufFile,
    maxModelLen,
    gpuCount,
    gpuMemoryUtilization,
    dtype,
    trustRemoteCode,
    seed,
    enableTools,
    toolParser,
    enforceEager,
    disableLogStats,
    generationConfig,
    vllmArgs,
    podName,
    containerImage,
    volumeInGb,
    containerDiskInGb,
    selectedRegion,
    suitableGpus,
  ]);

  const handleSaveConfig = () => {
    if (!selectedGpu || !vllmModel) {
      setError('Select a model and a GPU');
      return;
    }
    setError(null);
    if (vllmModel && vllmArgs) saveVllmArgsForModel(vllmModel, vllmArgs);
    const podConfig = buildPodConfigFromForm();
    if (!podConfig) return;
    const name =
      templateName?.trim() ||
      autoGeneratedConfigName ||
      (podConfig.name as string) ||
      'Unnamed';
    const cost = calculateEstimatedCost();
    saveRunpodTemplateMutation.mutate({
      name,
      podConfig,
      estimatedCostPerHour: cost ?? undefined,
    });
  };

  const calculateEstimatedCost = (): number | null => {
    if (!selectedGpu || !gpuAvailability) return null;
    const item = suitableGpus.find(
      (s) =>
        (s.gpu.id ?? (s.gpu as { gpuTypeId?: string }).gpuTypeId) ===
        selectedGpu
    );
    if (!item?.pricePerHour) return null;
    return item.needs2 ? item.pricePerHour * 2 : item.pricePerHour;
  };

  useEffect(() => {
    if (!createModalOpen) return;
    if (!gpuAvailability) loadGpuAvailability();
  }, [createModalOpen, gpuAvailability, loadGpuAvailability]);

  useEffect(() => {
    const q = modelSearchQuery;
    if (isSelectingModel) return;
    if (
      q === lastSelectedModelRef.current &&
      lastSelectedModelRef.current.length > 0
    )
      return;
    const filtered = getFilteredBookmarkedModels(q);
    if (!q || q.length < 2) {
      setModelSearchResults(filtered);
      setShowModelSearchResults(filtered.length > 0);
      return;
    }
    const t = setTimeout(() => searchHuggingFaceModels(q), 300);
    return () => clearTimeout(t);
  }, [
    modelSearchQuery,
    getFilteredBookmarkedModels,
    searchHuggingFaceModels,
    isSelectingModel,
  ]);

  useEffect(() => {
    if (vllmModel) {
      const settings = modelSettings[vllmModel];
      const argsFromSettings = settings?.vllmArgs;
      const argsFromLocal = modelVllmArgs[vllmModel];
      setVllmArgs(argsFromSettings ?? argsFromLocal ?? '');
      if (settings) {
        if (settings.maxModelLen != null)
          setMaxModelLen(Math.min(settings.maxModelLen, maxContextWindowLimit));
        if (settings.containerDiskInGb != null)
          setContainerDiskInGb(settings.containerDiskInGb);
        if (settings.volumeInGb != null) setVolumeInGb(settings.volumeInGb);
        if (settings.enableTools !== undefined)
          setEnableTools(settings.enableTools);
        if (settings.toolParser !== undefined)
          setToolParser(settings.toolParser ?? '');
        if (settings.autoToolChoice !== undefined)
          setAutoToolChoice(settings.autoToolChoice);
        if (settings.dtype !== undefined) setDtype(settings.dtype ?? 'auto');
        if (settings.trustRemoteCode !== undefined)
          setTrustRemoteCode(settings.trustRemoteCode);
        if (settings.gpuMemoryUtilization !== undefined)
          setGpuMemoryUtilization(settings.gpuMemoryUtilization);
        if (settings.seed !== undefined)
          setSeed(settings.seed === 0 ? 0 : settings.seed || '');
        if (settings.maxNumSeqs !== undefined)
          setMaxNumSeqs(settings.maxNumSeqs ?? 256);
        if (settings.enforceEager !== undefined)
          setEnforceEager(settings.enforceEager);
        if (settings.disableLogStats !== undefined)
          setDisableLogStats(settings.disableLogStats);
        if (settings.generationConfig !== undefined)
          setGenerationConfig(settings.generationConfig ?? '');
      }
    } else setVllmArgs('');
  }, [vllmModel, modelVllmArgs, modelSettings, maxContextWindowLimit]);

  useEffect(() => {
    const minGb = effectiveMinContainerDiskGb;
    if (minGb != null && vllmModel && containerDiskInGb < minGb) {
      const newSize = Math.ceil(minGb);
      setContainerDiskInGb(newSize);
      saveModelSettings(vllmModel, { containerDiskInGb: newSize });
    }
  }, [effectiveMinContainerDiskGb, vllmModel]);

  useEffect(() => {
    if (selectedModelMetadata?.config?._extracted) {
      setSuggestedVllmArgs(
        generateVllmArgsFromArchitecture(
          selectedModelMetadata.config._extracted as Parameters<
            typeof generateVllmArgsFromArchitecture
          >[0],
          gpuCount
        )
      );
    } else setSuggestedVllmArgs(null);
  }, [gpuCount, selectedModelMetadata]);

  const disconnect = () => {
    localStorage.removeItem(RUNPOD_CONFIG_KEY);
    setConfigSaved(false);
    setApiKey('');
    setEndpoint(DEFAULT_ENDPOINT);
    configForm.setValues({
      apiKey: '',
      endpoint: DEFAULT_ENDPOINT,
      hfToken: '',
    });
    setPods([]);
    setBillingInfo(null);
    setError(null);
  };

  const saveHfToken = (token: string) => {
    try {
      const raw = localStorage.getItem(RUNPOD_CONFIG_KEY);
      const current = raw ? JSON.parse(raw) : {};
      localStorage.setItem(
        RUNPOD_CONFIG_KEY,
        JSON.stringify({ ...current, hfToken: token?.trim() ?? '' })
      );
      configForm.setFieldValue('hfToken', token?.trim() ?? '');
    } catch {
      // ignore
    }
    setHfTokenModalOpen(false);
  };

  if (!configSaved) {
    return (
      <Box p="md" maw={480} mx="auto">
        <Paper p="lg" shadow="sm" radius="md" withBorder>
          <Stack gap="md">
            <Text size="xl" fw={700}>
              RunPod
            </Text>
            <Text size="sm" c="dimmed">
              Connect with your RunPod API key to manage pods. Get your key from{' '}
              <a
                href="https://www.runpod.io/console/user/settings"
                target="_blank"
                rel="noopener noreferrer"
              >
                RunPod Console
              </a>
              .
            </Text>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveConnection();
              }}
            >
              <Stack gap="md">
                <PasswordInput
                  label="API Key"
                  placeholder="Enter your RunPod API key"
                  {...configForm.getInputProps('apiKey')}
                />
                <TextInput
                  label="API Endpoint"
                  placeholder={DEFAULT_ENDPOINT}
                  {...configForm.getInputProps('endpoint')}
                />
                <PasswordInput
                  label="HuggingFace Token (optional)"
                  placeholder="hf_..."
                  description="For gated models and Hugging Face API. Stored locally only."
                  {...configForm.getInputProps('hfToken')}
                />
                {error && (
                  <Alert
                    color="red"
                    icon={<IconAlertCircle size={16} />}
                    title="Error"
                  >
                    {error}
                  </Alert>
                )}
                <Button type="submit" loading={checkConnection.isPending}>
                  Save & Connect
                </Button>
              </Stack>
            </form>
          </Stack>
        </Paper>
        <Group mt="md">
          <Link to="/">← Back to Chat</Link>
        </Group>
      </Box>
    );
  }

  const runningPods = pods.filter(
    (p) => (p.status || '').toUpperCase() === 'RUNNING'
  );
  const totalHourlyCost = runningPods.reduce(
    (sum, p) => sum + (p.costPerHour ?? 0),
    0
  );
  const effectiveHourlyCost = billingInfo?.currentSpendPerHr ?? totalHourlyCost;
  const hoursRemaining =
    billingInfo?.credits != null && effectiveHourlyCost > 0
      ? billingInfo.credits / effectiveHourlyCost
      : null;

  return (
    <Box p="md" style={{ maxWidth: 900, margin: '0 auto' }}>
      <Group justify="space-between" mb="md">
        <Group>
          <Text size="xl" fw={700}>
            RunPod
          </Text>
          <Link
            to="/"
            style={{ fontSize: 14, color: 'var(--mantine-color-dimmed)' }}
          >
            ← Chat
          </Link>
        </Group>
        <Group>
          <Button
            leftSection={<IconPlus size={16} />}
            variant="light"
            onClick={() => {
              setCreateModalOpen(true);
              if (!gpuAvailability) loadGpuAvailability();
            }}
          >
            New pod
          </Button>
          <Button
            variant="light"
            leftSection={<IconRefresh size={16} />}
            loading={getPodsMutation.isPending}
            onClick={loadPods}
          >
            Refresh
          </Button>
          <Button
            variant="subtle"
            color="gray"
            leftSection={<IconKey size={16} />}
            onClick={() => {
              try {
                const raw = localStorage.getItem(RUNPOD_CONFIG_KEY);
                const c = raw ? JSON.parse(raw) : {};
                setHfTokenEditValue(c.hfToken ?? '');
              } catch {
                setHfTokenEditValue('');
              }
              setHfTokenModalOpen(true);
            }}
          >
            HuggingFace token
          </Button>
          <Button
            variant="subtle"
            color="gray"
            leftSection={<IconLogout size={16} />}
            onClick={disconnect}
          >
            Disconnect
          </Button>
        </Group>
      </Group>

      {error && (
        <Alert
          color="red"
          icon={<IconAlertCircle size={16} />}
          title="Error"
          mb="md"
          onClose={() => setError(null)}
          withCloseButton
        >
          {error}
        </Alert>
      )}

      {/* Billing bar */}
      <Card withBorder padding="sm" mb="md">
        <Group justify="space-between">
          <Group gap="xl">
            <Group gap="xs">
              <Text size="sm" c="dimmed">
                Balance
              </Text>
              <Text fw={600}>
                {billingInfo?.credits != null
                  ? `$${billingInfo.credits.toFixed(2)}`
                  : '—'}
              </Text>
            </Group>
            <Group gap="xs">
              <Text size="sm" c="dimmed">
                Cost/hr
              </Text>
              <Text fw={600}>
                {billingInfo?.currentSpendPerHr != null
                  ? `$${billingInfo.currentSpendPerHr.toFixed(2)}`
                  : `$${totalHourlyCost.toFixed(2)}`}
              </Text>
            </Group>
            {hoursRemaining != null && (
              <Group gap="xs">
                <Text size="sm" c="dimmed">
                  Runtime
                </Text>
                <Text
                  fw={600}
                  c={
                    hoursRemaining < 1
                      ? 'red'
                      : hoursRemaining < 24
                        ? 'yellow'
                        : 'green'
                  }
                >
                  {hoursRemaining < 1
                    ? `${Math.floor(hoursRemaining * 60)}m`
                    : hoursRemaining < 24
                      ? `${hoursRemaining.toFixed(1)}h`
                      : `${(hoursRemaining / 24).toFixed(1)}d`}
                </Text>
              </Group>
            )}
          </Group>
        </Group>
      </Card>

      {/* Saved configs */}
      <Paper withBorder p="md" radius="md" mb="md">
        <Text fw={600} mb="md">
          Saved configs
        </Text>
        {!runpodTemplatesQuery.data?.length ? (
          <Text c="dimmed" size="sm">
            No saved configs. Use &quot;New pod&quot; to configure and click
            &quot;Save Config&quot; to save a template, then Start/Stop here.
          </Text>
        ) : (
          <Stack gap="xs">
            {runpodTemplatesQuery.data.map((template) => {
              const isRunning = Boolean(
                template.launchedPodId &&
                pods.some(
                  (p) =>
                    p.id === template.launchedPodId &&
                    (p.status || '').toUpperCase() === 'RUNNING'
                )
              );
              const podNameFromConfig =
                (template.podConfig?.name as string) || template.name;
              return (
                <Card key={template.id} withBorder padding="sm" radius="md">
                  <Group justify="space-between" wrap="nowrap">
                    <Box style={{ minWidth: 0 }}>
                      <Text fw={500} truncate>
                        {template.name}
                      </Text>
                      <Text size="xs" c="dimmed" truncate>
                        {podNameFromConfig}
                      </Text>
                      {template.estimatedCostPerHour != null && (
                        <Text size="xs" c="dimmed">
                          ${template.estimatedCostPerHour.toFixed(2)}/hr
                        </Text>
                      )}
                      {(() => {
                        const av = getTemplateGpuAvailability(
                          gpuAvailability ?? null,
                          template
                        );
                        return av ? (
                          <Text
                            size="xs"
                            c={av.availableRegions > 0 ? 'dimmed' : 'orange'}
                            mt={2}
                          >
                            {av.availableRegions > 0
                              ? `${av.availableRegions} region${av.availableRegions !== 1 ? 's' : ''} available`
                              : 'Out of stock'}
                          </Text>
                        ) : null;
                      })()}
                      {isRunning && template.launchedPodId && (
                        <Text size="xs" c="green" mt={4}>
                          Running · {template.launchedPodId}
                        </Text>
                      )}
                    </Box>
                    <Group gap="xs" wrap="nowrap">
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconPlayerPlay size={14} />}
                        disabled={!apiKey?.trim() || isRunning}
                        loading={
                          pendingTemplateId === template.id &&
                          launchRunpodTemplateMutation.isPending
                        }
                        onClick={() => {
                          setPendingTemplateId(template.id);
                          launchRunpodTemplateMutation.mutate({
                            ...config,
                            templateId: template.id,
                          });
                        }}
                      >
                        Start
                      </Button>
                      <Button
                        size="xs"
                        variant="subtle"
                        color="orange"
                        leftSection={<IconPlayerStop size={14} />}
                        disabled={!isRunning}
                        loading={
                          pendingTemplateId === template.id &&
                          stopRunpodTemplateMutation.isPending
                        }
                        onClick={() => {
                          setPendingTemplateId(template.id);
                          stopRunpodTemplateMutation.mutate({
                            ...config,
                            templateId: template.id,
                          });
                        }}
                      >
                        Stop
                      </Button>
                      <Tooltip label="Delete config">
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          color="red"
                          onClick={() =>
                            deleteRunpodTemplateMutation.mutate({
                              templateId: template.id,
                            })
                          }
                          loading={deleteRunpodTemplateMutation.isPending}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Group>
                </Card>
              );
            })}
          </Stack>
        )}
      </Paper>

      {/* Pod list */}
      <Paper withBorder p="md" radius="md">
        <Text fw={600} mb="md">
          Pods
        </Text>
        {pods.length === 0 ? (
          <Text c="dimmed" size="sm">
            No pods. Click &quot;New pod&quot; to create one, or Refresh to
            load.
          </Text>
        ) : (
          <Stack gap="xs">
            {pods.map((pod) => {
              const statusUpper = (pod.status || '').toUpperCase();
              const isRunning = statusUpper === 'RUNNING';
              const canStart =
                !isRunning &&
                statusUpper !== 'TERMINATING' &&
                statusUpper !== 'PENDING';
              const canStop = isRunning;
              const gpuName = pod.machine?.gpuName ?? 'Unknown';

              return (
                <Card key={pod.id} withBorder padding="sm" radius="md">
                  <Group justify="space-between" wrap="nowrap">
                    <Group wrap="nowrap" style={{ minWidth: 0 }}>
                      <ThemeIcon
                        size="sm"
                        color={getStatusColor(pod.status)}
                        radius="xl"
                      />
                      <Box style={{ minWidth: 0 }}>
                        <Group gap="xs" wrap="nowrap">
                          <Text fw={500} truncate>
                            {pod.name || pod.id}
                          </Text>
                          {defaultPodData?.defaultPodId === pod.id && (
                            <Badge
                              size="sm"
                              color="blue"
                              variant="light"
                              leftSection={<IconPinFilled size={10} />}
                            >
                              Default
                            </Badge>
                          )}
                          <Badge
                            size="sm"
                            color={getStatusColor(pod.status)}
                            variant="light"
                          >
                            {isRunning
                              ? 'On'
                              : statusUpper === 'STOPPED' ||
                                  statusUpper === 'EXITED'
                                ? 'Off'
                                : pod.status}
                          </Badge>
                          {isRunning && (
                            <Badge
                              size="sm"
                              color={pod.proxyReady ? 'green' : 'yellow'}
                              variant="light"
                            >
                              {pod.proxyReady === true ? 'Ready' : 'Starting…'}
                            </Badge>
                          )}
                          {isRunning && pod.uptimeSeconds != null && (
                            <Text size="xs" c="dimmed">
                              {formatUptime(pod.uptimeSeconds)}
                            </Text>
                          )}
                        </Group>
                        <Text size="xs" c="dimmed" truncate>
                          {pod.id}
                        </Text>
                        <Group gap="xs" mt={4}>
                          {pod.costPerHour != null && (
                            <Text size="xs">
                              ${pod.costPerHour.toFixed(2)}/hr
                            </Text>
                          )}
                          {pod.gpuCount > 0 && (
                            <Text size="xs">{pod.gpuCount}x GPU</Text>
                          )}
                          {gpuName !== 'Unknown' && (
                            <Text size="xs">{gpuName}</Text>
                          )}
                          {pod.machine?.gpuMemoryGb != null && (
                            <Text size="xs">
                              {pod.machine.gpuMemoryGb}GB VRAM
                            </Text>
                          )}
                        </Group>
                        {pod.imageName?.includes('vllm') && isRunning && (
                          <Group gap="xs" mt={4}>
                            <Text size="xs" c="dimmed">
                              API:
                            </Text>
                            <Text
                              size="xs"
                              component="a"
                              href={`https://${pod.id}-8000.proxy.runpod.net/`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ fontFamily: 'monospace' }}
                            >
                              https://{pod.id}-8000.proxy.runpod.net/
                            </Text>
                            <Tooltip label="Copy">
                              <ActionIcon
                                size="xs"
                                variant="subtle"
                                onClick={() =>
                                  navigator.clipboard.writeText(
                                    `https://${pod.id}-8000.proxy.runpod.net/`
                                  )
                                }
                              >
                                <IconCopy size={12} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        )}
                      </Box>
                    </Group>
                    <Group gap="xs" wrap="nowrap">
                      {defaultPodData?.defaultPodId === pod.id ? (
                        <Tooltip label="Clear default for this project">
                          <ActionIcon
                            variant="light"
                            color="blue"
                            onClick={() =>
                              setDefaultPodMutation.mutate({ podId: null })
                            }
                            loading={setDefaultPodMutation.isPending}
                          >
                            <IconPinFilled size={16} />
                          </ActionIcon>
                        </Tooltip>
                      ) : (
                        <Tooltip label="Set as default for this project (use as RunPod provider in Chat)">
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            onClick={() =>
                              setDefaultPodMutation.mutate({ podId: pod.id })
                            }
                            loading={setDefaultPodMutation.isPending}
                          >
                            <IconPin size={16} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      {canStart && (
                        <Tooltip label="Start">
                          <ActionIcon
                            color="green"
                            variant="light"
                            onClick={() => handleStartPod(pod.id)}
                            loading={startPodMutation.isPending}
                          >
                            <IconPlayerPlay size={16} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      {canStop && (
                        <Tooltip label="Stop">
                          <ActionIcon
                            color="yellow"
                            variant="light"
                            onClick={() => handleStopPod(pod.id)}
                            loading={stopPodMutation.isPending}
                          >
                            <IconPlayerStop size={16} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      <Tooltip label="Open in RunPod Console">
                        <ActionIcon
                          component="a"
                          href={`https://www.runpod.io/console/pods/${pod.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          variant="light"
                          color="gray"
                        >
                          <IconExternalLink size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Delete pod">
                        <ActionIcon
                          color="red"
                          variant="light"
                          onClick={() => handleDeletePod(pod.id)}
                          loading={deletePodMutation.isPending}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Group>
                </Card>
              );
            })}
          </Stack>
        )}
      </Paper>

      <Modal
        opened={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="New Pod"
        size="xl"
        styles={{ content: { maxWidth: 1500 } }}
      >
        <Stack gap="xs" mb="md">
          <Textarea
            variant="unstyled"
            placeholder={autoGeneratedConfigName ?? 'vllm-openai-auto'}
            value={typeof templateName === 'string' ? templateName : ''}
            onChange={(e) => {
              setTemplateName(e.target.value);
              setUserHasEditedTemplateName(true);
            }}
            style={{
              width: '100%',
              fontFamily: 'inherit',
              fontSize: 'var(--mantine-font-size-lg)',
              fontWeight: 600,
            }}
            styles={{
              root: { width: '100%' },
              input: {
                border: '1px solid var(--mantine-color-default-border)',
                borderRadius: 'var(--mantine-radius-xs)',
                background: 'var(--mantine-color-default-hover)',
                padding: '2px 6px',
                height: 28,
                minHeight: 28,
                maxHeight: 28,
                overflow: 'hidden',
                width: '100%',
              },
            }}
          />
          {(() => {
            const raw =
              typeof templateName === 'string' ? templateName.trim() : '';
            const slug = raw ? slugify(raw) : autoGeneratedConfigName || null;
            if (!slug) return null;
            return (
              <Text
                size="xs"
                c="dimmed"
                style={{ fontFamily: '"Atkinson Hyperlegible", sans-serif' }}
              >
                Pod name: {slug}
              </Text>
            );
          })()}
        </Stack>
        <Grid gutter="md">
          {/* Col 1: Model + GPU */}
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Stack gap="md">
              <Text size="sm" fw={600} c="dimmed">
                Model
              </Text>
              <TextInput
                placeholder="Search HuggingFace models..."
                value={modelSearchQuery}
                onChange={(e) => {
                  const v = e.target.value;
                  setModelSearchQuery(v);
                  setVllmModel(v);
                  if (v !== lastSelectedModelRef.current)
                    lastSelectedModelRef.current = '';
                  if (!v.includes('/') || v.length < 3)
                    setSelectedModelMetadata(null);
                }}
                onFocus={() => {
                  const filtered =
                    getFilteredBookmarkedModels(modelSearchQuery);
                  if (filtered.length > 0 || modelSearchResults.length > 0)
                    setShowModelSearchResults(true);
                }}
                onBlur={() =>
                  setTimeout(() => setShowModelSearchResults(false), 200)
                }
                rightSection={modelSearchLoading ? <Loader size="xs" /> : null}
              />
              {showModelSearchResults && modelSearchResults.length > 0 && (
                <Paper
                  withBorder
                  p="xs"
                  style={{ maxHeight: 200, overflow: 'auto' }}
                >
                  {modelSearchResults.map((model) => (
                    <UnstyledButton
                      key={model.id}
                      onMouseDown={(e) => {
                        if (
                          (e.target as HTMLElement).closest(
                            '[data-model-row-bookmark]'
                          )
                        )
                          return;
                        e.preventDefault();
                        lastSelectedModelRef.current = model.id;
                        setIsSelectingModel(true);
                        setVllmModel(model.id);
                        setModelSearchQuery(model.id);
                        setShowModelSearchResults(false);
                        if (model.id.includes('/'))
                          fetchModelMetadata(model.id);
                        const settings = modelSettings[model.id];
                        setVllmArgs(
                          settings?.vllmArgs ?? modelVllmArgs[model.id] ?? ''
                        );
                        if (settings?.maxModelLen != null)
                          setMaxModelLen(
                            Math.min(
                              settings.maxModelLen,
                              maxContextWindowLimit
                            )
                          );
                        if (settings?.containerDiskInGb != null)
                          setContainerDiskInGb(settings.containerDiskInGb);
                        if (settings?.volumeInGb != null)
                          setVolumeInGb(settings.volumeInGb);
                        if (settings?.enableTools !== undefined)
                          setEnableTools(settings.enableTools);
                        if (settings?.toolParser !== undefined)
                          setToolParser(settings.toolParser ?? '');
                        if (settings?.autoToolChoice !== undefined)
                          setAutoToolChoice(settings.autoToolChoice);
                        if (settings?.dtype !== undefined)
                          setDtype(settings.dtype ?? 'auto');
                        if (settings?.trustRemoteCode !== undefined)
                          setTrustRemoteCode(settings.trustRemoteCode);
                        if (settings?.gpuMemoryUtilization !== undefined)
                          setGpuMemoryUtilization(
                            settings.gpuMemoryUtilization
                          );
                        if (settings?.seed !== undefined)
                          setSeed(
                            settings.seed === 0 ? 0 : (settings.seed ?? '')
                          );
                        if (settings?.maxNumSeqs !== undefined)
                          setMaxNumSeqs(settings.maxNumSeqs ?? 256);
                        if (settings?.enforceEager !== undefined)
                          setEnforceEager(settings.enforceEager);
                        if (settings?.disableLogStats !== undefined)
                          setDisableLogStats(settings.disableLogStats);
                        if (settings?.generationConfig !== undefined)
                          setGenerationConfig(settings.generationConfig ?? '');
                        setTimeout(() => setIsSelectingModel(false), 500);
                      }}
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: '6px 8px',
                        borderRadius: 4,
                        textAlign: 'left',
                      }}
                      className="hover:bg-gray-100"
                    >
                      <Group justify="space-between" wrap="nowrap">
                        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                          {model.isBookmarked && (
                            <IconStarFilled
                              size={14}
                              color="var(--mantine-color-yellow-6)"
                            />
                          )}
                          <Text size="sm" fw={500} truncate>
                            {model.id}
                          </Text>
                        </Group>
                        <ActionIcon
                          data-model-row-bookmark
                          size="sm"
                          variant="subtle"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleBookmark(model.id, e);
                          }}
                        >
                          {model.isBookmarked ? (
                            <IconStarFilled size={14} />
                          ) : (
                            <IconStar size={14} />
                          )}
                        </ActionIcon>
                      </Group>
                      {!model.isBookmarkedOnly && (
                        <Text size="xs" c="dimmed">
                          {model.pipeline_tag ?? ''}{' '}
                          {model.downloads != null
                            ? `• ${model.downloads.toLocaleString()} dl`
                            : ''}
                        </Text>
                      )}
                    </UnstyledButton>
                  ))}
                </Paper>
              )}

              {ggufFiles.length > 0 && (
                <Select
                  label="Quantization (GGUF)"
                  placeholder="Select..."
                  size="xs"
                  data={ggufFiles.map((f) => ({
                    value: f.path,
                    label: f.label,
                  }))}
                  value={selectedGgufFile ?? ''}
                  onChange={(v) => setSelectedGgufFile(v || null)}
                  clearable
                />
              )}

              {selectedModelMetadata?.config?._extracted && (
                <Accordion variant="contained">
                  <Accordion.Item value="info">
                    <Accordion.Control>Model info</Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap="xs">
                        {selectedModelMetadata.config._extracted.modelType && (
                          <Group justify="space-between" gap="xs">
                            <Text size="xs" c="dimmed">
                              Architecture
                            </Text>
                            <Text size="xs">
                              {String(
                                selectedModelMetadata.config._extracted
                                  .modelType
                              )}
                            </Text>
                          </Group>
                        )}
                        {selectedModelMetadata.config._extracted
                          .maxContextWindow != null && (
                          <Group justify="space-between" gap="xs">
                            <Text size="xs" c="dimmed">
                              Max context
                            </Text>
                            <Text size="xs">
                              {Number(
                                selectedModelMetadata.config._extracted
                                  .maxContextWindow
                              ).toLocaleString()}{' '}
                              tokens
                            </Text>
                          </Group>
                        )}
                        {selectedModelMetadata.config._extracted.hiddenSize !=
                          null && (
                          <Group justify="space-between" gap="xs">
                            <Text size="xs" c="dimmed">
                              Hidden size
                            </Text>
                            <Text size="xs">
                              {Number(
                                selectedModelMetadata.config._extracted
                                  .hiddenSize
                              ).toLocaleString()}
                            </Text>
                          </Group>
                        )}
                        {selectedModelMetadata.config._extracted.numLayers !=
                          null && (
                          <Group justify="space-between" gap="xs">
                            <Text size="xs" c="dimmed">
                              Layers
                            </Text>
                            <Text size="xs">
                              {Number(
                                selectedModelMetadata.config._extracted
                                  .numLayers
                              )}
                            </Text>
                          </Group>
                        )}
                        {selectedModelMetadata.config._extracted
                          .numAttentionHeads != null && (
                          <Group justify="space-between" gap="xs">
                            <Text size="xs" c="dimmed">
                              Attention heads
                            </Text>
                            <Text size="xs">
                              {Number(
                                selectedModelMetadata.config._extracted
                                  .numAttentionHeads
                              )}
                              {selectedModelMetadata.config._extracted
                                .numKeyValueHeads != null &&
                              selectedModelMetadata.config._extracted
                                .numKeyValueHeads !==
                                selectedModelMetadata.config._extracted
                                  .numAttentionHeads
                                ? ` (KV: ${selectedModelMetadata.config._extracted.numKeyValueHeads})`
                                : ''}
                            </Text>
                          </Group>
                        )}
                        {selectedModelMetadata.config._extracted.vocabSize !=
                          null && (
                          <Group justify="space-between" gap="xs">
                            <Text size="xs" c="dimmed">
                              Vocab size
                            </Text>
                            <Text size="xs">
                              {Number(
                                selectedModelMetadata.config._extracted
                                  .vocabSize
                              ).toLocaleString()}
                            </Text>
                          </Group>
                        )}
                        {selectedModelMetadata.config._extracted.torchDtype && (
                          <Group justify="space-between" gap="xs">
                            <Text size="xs" c="dimmed">
                              Dtype
                            </Text>
                            <Text size="xs">
                              {String(
                                selectedModelMetadata.config._extracted
                                  .torchDtype
                              )}
                            </Text>
                          </Group>
                        )}
                        {selectedModelMetadata.config._extracted
                          .quantizationConfig && (
                          <Group justify="space-between" gap="xs">
                            <Text size="xs" c="dimmed">
                              Quantization
                            </Text>
                            <Text size="xs" c="yellow">
                              Yes
                            </Text>
                          </Group>
                        )}
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                </Accordion>
              )}
              <Divider />
              <Text size="xs" fw={600} c="dimmed">
                GPU
              </Text>
              {gpuLoading ? (
                <Text size="xs" c="dimmed">
                  Loading GPUs...
                </Text>
              ) : suitableGpus.length > 0 ? (
                <>
                  <Menu
                    opened={gpuDropdownOpen}
                    onClose={() => setGpuDropdownOpen(false)}
                    position="bottom-start"
                    width="target"
                  >
                    <Menu.Target>
                      <UnstyledButton
                        onClick={() => setGpuDropdownOpen((o) => !o)}
                        style={{
                          border:
                            '1px solid var(--mantine-color-default-border)',
                          borderRadius: 'var(--mantine-radius-sm)',
                          padding: '6px 10px',
                          width: '100%',
                          textAlign: 'left',
                          minWidth: 0,
                        }}
                      >
                        {selectedGpu ? (
                          (() => {
                            const item = suitableGpus.find(
                              (s) =>
                                (s.gpu.id ??
                                  (s.gpu as { gpuTypeId?: string })
                                    .gpuTypeId) === selectedGpu
                            );
                            if (!item)
                              return (
                                <Text size="xs" c="dimmed">
                                  Select GPU
                                </Text>
                              );
                            const name = (item.gpu.displayName ??
                              item.gpu.name ??
                              item.gpu.id ??
                              selectedGpu) as string;
                            const mem = item.gpu.memoryInGb;
                            const totalPrice =
                              item.needs2 && item.pricePerHour
                                ? item.pricePerHour * 2
                                : item.pricePerHour;
                            return (
                              <Group
                                justify="space-between"
                                wrap="nowrap"
                                gap="xs"
                                style={{ minWidth: 0 }}
                              >
                                <Group
                                  gap="xs"
                                  wrap="nowrap"
                                  style={{ minWidth: 0 }}
                                >
                                  <Box
                                    w={6}
                                    h={6}
                                    style={{
                                      borderRadius: '50%',
                                      backgroundColor: gpuStatusDotColor(
                                        item.status
                                      ),
                                      flexShrink: 0,
                                    }}
                                  />
                                  <Text
                                    size="xs"
                                    truncate
                                    style={{ fontSize: 11 }}
                                  >
                                    {name}
                                    {mem != null ? ` (${mem}G)` : ''}
                                  </Text>
                                  {item.needs2 && (
                                    <Badge
                                      size="xs"
                                      variant="light"
                                      color="yellow"
                                      style={{ fontSize: 10 }}
                                    >
                                      2×
                                    </Badge>
                                  )}
                                </Group>
                                {totalPrice != null && (
                                  <Text
                                    size="xs"
                                    c="dimmed"
                                    style={{ fontSize: 11 }}
                                  >
                                    ${totalPrice.toFixed(2)}/hr
                                  </Text>
                                )}
                              </Group>
                            );
                          })()
                        ) : (
                          <Text size="xs" c="dimmed">
                            Select GPU
                          </Text>
                        )}
                      </UnstyledButton>
                    </Menu.Target>
                    <Menu.Dropdown style={{ padding: 0, minWidth: 280 }}>
                      <ScrollArea.Autosize mah={320}>
                        <Table
                          withRowBorders={false}
                          withColumnBorders={false}
                          withTableBorder={false}
                        >
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th
                                style={{
                                  width: 10,
                                  padding: '4px 6px',
                                  fontSize: 10,
                                }}
                              />
                              <Table.Th
                                style={{ padding: '4px 6px', fontSize: 10 }}
                              >
                                GPU
                              </Table.Th>
                              <Table.Th
                                style={{
                                  padding: '4px 6px',
                                  fontSize: 10,
                                  textAlign: 'right',
                                }}
                              >
                                Mem (GB)
                              </Table.Th>
                              <Table.Th
                                style={{ padding: '4px 6px', fontSize: 10 }}
                              >
                                Cloud
                              </Table.Th>
                              <Table.Th
                                style={{
                                  padding: '4px 6px',
                                  fontSize: 10,
                                  fontFamily:
                                    '"Atkinson Hyperlegible", sans-serif',
                                  fontVariantNumeric: 'tabular-nums',
                                  textAlign: 'right',
                                }}
                              >
                                $/hr
                              </Table.Th>
                              <Table.Th
                                style={{ padding: '4px 6px', fontSize: 10 }}
                              >
                                Availability
                              </Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {suitableGpus.map((item) => {
                              const id =
                                item.gpu.id ??
                                (item.gpu as { gpuTypeId?: string })
                                  .gpuTypeId ??
                                '';
                              const name = (item.gpu.displayName ??
                                item.gpu.name ??
                                id) as string;
                              const mem = item.gpu.memoryInGb;
                              const cloudType = (
                                item.gpu as { secureCloud?: boolean }
                              ).secureCloud
                                ? 'Sec'
                                : 'Com';
                              const totalPrice =
                                item.needs2 && item.pricePerHour
                                  ? item.pricePerHour * 2
                                  : item.pricePerHour;
                              const isSelected = id === selectedGpu;
                              const fixedFontStyle: React.CSSProperties = {
                                fontFamily:
                                  '"Atkinson Hyperlegible", sans-serif',
                                fontVariantNumeric: 'tabular-nums',
                              };
                              return (
                                <Table.Tr
                                  key={id}
                                  onClick={() => {
                                    setSelectedGpu(id);
                                    if (item.needs2) setGpuCount(2);
                                    setGpuDropdownOpen(false);
                                  }}
                                  style={{
                                    cursor: 'pointer',
                                    fontSize: 11,
                                    backgroundColor: isSelected
                                      ? 'var(--mantine-color-light)'
                                      : undefined,
                                  }}
                                >
                                  <Table.Td
                                    style={{ width: 10, padding: '2px 6px' }}
                                  >
                                    <Box
                                      w={6}
                                      h={6}
                                      style={{
                                        borderRadius: '50%',
                                        backgroundColor: gpuStatusDotColor(
                                          item.status
                                        ),
                                      }}
                                    />
                                  </Table.Td>
                                  <Table.Td
                                    style={{
                                      padding: '2px 6px',
                                      maxWidth: 140,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }}
                                    title={name}
                                  >
                                    {name}
                                    {item.needs2 && ' 2×'}
                                  </Table.Td>
                                  <Table.Td
                                    style={{
                                      padding: '2px 6px',
                                      fontSize: 11,
                                      textAlign: 'right',
                                      ...fixedFontStyle,
                                    }}
                                  >
                                    {mem != null ? mem : '—'}
                                  </Table.Td>
                                  <Table.Td
                                    style={{
                                      padding: '2px 6px',
                                      fontSize: 11,
                                      color: 'var(--mantine-color-dimmed)',
                                    }}
                                  >
                                    {cloudType}
                                  </Table.Td>
                                  <Table.Td
                                    style={{
                                      padding: '2px 6px',
                                      fontSize: 11,
                                      textAlign: 'right',
                                      ...fixedFontStyle,
                                    }}
                                  >
                                    {totalPrice != null
                                      ? `$${totalPrice.toFixed(2)}`
                                      : '—'}
                                  </Table.Td>
                                  <Table.Td
                                    style={{
                                      padding: '2px 6px',
                                      fontSize: 10,
                                      color: 'var(--mantine-color-dimmed)',
                                    }}
                                  >
                                    {item.availability
                                      ? item.availability.availableRegions > 0
                                        ? `${item.availability.availableRegions} region${item.availability.availableRegions !== 1 ? 's' : ''}`
                                        : item.availability.stockStatus ===
                                              'OUT_OF_STOCK' ||
                                            item.availability.stockStatus ===
                                              'OUT_OF_STOCK_LOW_SUPPLY'
                                          ? 'Out of stock'
                                          : 'Unavailable'
                                      : '—'}
                                  </Table.Td>
                                </Table.Tr>
                              );
                            })}
                          </Table.Tbody>
                        </Table>
                      </ScrollArea.Autosize>
                    </Menu.Dropdown>
                  </Menu>
                  <Text size="xs" c="dimmed" style={{ fontSize: 10 }}>
                    <Box
                      component="span"
                      style={{
                        display: 'inline-block',
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        backgroundColor: gpuStatusDotColor('good'),
                        marginRight: 3,
                        verticalAlign: 'middle',
                      }}
                    />{' '}
                    Good
                    {' · '}
                    <Box
                      component="span"
                      style={{
                        display: 'inline-block',
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        backgroundColor: gpuStatusDotColor('close'),
                        marginRight: 3,
                        verticalAlign: 'middle',
                      }}
                    />{' '}
                    Tight
                    {' · '}
                    <Box
                      component="span"
                      style={{
                        display: 'inline-block',
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        backgroundColor: gpuStatusDotColor('needs2'),
                        marginRight: 3,
                        verticalAlign: 'middle',
                      }}
                    />{' '}
                    2×
                  </Text>
                  {selectedGpu &&
                    gpuAvailability?.gpuDatacenterAvailability?.[selectedGpu]
                      ?.length > 0 && (
                      <Box mt={4}>
                        <Text size="xs" fw={500} c="dimmed" mb={4}>
                          Availability by region
                        </Text>
                        <Stack gap={2}>
                          {(
                            gpuAvailability.gpuDatacenterAvailability[
                              selectedGpu
                            ] as Array<{
                              datacenterId: string;
                              datacenterName: string;
                              location: string;
                              stockStatus: string | null;
                            }>
                          ).map((dc) => {
                            const status = dc.stockStatus ?? '—';
                            const statusColor =
                              status.toUpperCase() === 'HIGH'
                                ? 'green'
                                : status.toUpperCase() === 'MEDIUM'
                                  ? 'yellow'
                                  : status.toUpperCase() === 'LOW'
                                    ? 'orange'
                                    : 'dimmed';
                            return (
                              <Group
                                key={dc.datacenterId}
                                gap="xs"
                                wrap="nowrap"
                              >
                                <Text
                                  size="xs"
                                  style={{ minWidth: 80 }}
                                  truncate
                                  title={dc.location}
                                >
                                  {dc.datacenterName || dc.datacenterId}
                                </Text>
                                <Badge
                                  size="xs"
                                  variant="light"
                                  color={statusColor}
                                >
                                  {status}
                                </Badge>
                              </Group>
                            );
                          })}
                        </Stack>
                      </Box>
                    )}
                  {gpuAvailability?.datacenters &&
                    Array.isArray(gpuAvailability.datacenters) &&
                    gpuAvailability.datacenters.length > 0 && (
                      <Select
                        label="Region"
                        placeholder="Auto"
                        size="xs"
                        value={selectedRegion}
                        onChange={(v) => setSelectedRegion(v ?? '')}
                        data={
                          selectedGpu &&
                          gpuAvailability.gpuDatacenterAvailability?.[
                            selectedGpu
                          ]?.length
                            ? (
                                gpuAvailability.gpuDatacenterAvailability[
                                  selectedGpu
                                ] as Array<{
                                  datacenterId: string;
                                  datacenterName: string;
                                  stockStatus: string | null;
                                }>
                              ).map((dc) => ({
                                value: dc.datacenterId,
                                label: dc.stockStatus
                                  ? `${dc.datacenterName || dc.datacenterId} (${dc.stockStatus})`
                                  : dc.datacenterName || dc.datacenterId,
                              }))
                            : (
                                gpuAvailability.datacenters as {
                                  id?: string;
                                  name?: string;
                                  location?: string;
                                }[]
                              ).map((dc) => ({
                                value: dc.id ?? dc.name ?? '',
                                label: dc.name ?? dc.location ?? dc.id ?? '',
                              }))
                        }
                        clearable
                      />
                    )}
                </>
              ) : (
                <Button variant="light" size="sm" onClick={loadGpuAvailability}>
                  Load GPUs
                </Button>
              )}
            </Stack>
          </Grid.Col>

          {/* Col 2: Settings */}
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Stack gap="sm">
              <Text size="sm" fw={600} c="dimmed">
                Settings
              </Text>
              <TextInput
                label="Pod name (when launched)"
                placeholder="Auto-generated from config name"
                size="xs"
                value={podName}
                onChange={(e) => setPodName(e.target.value)}
              />
              <TextInput
                label="Container image"
                size="xs"
                value={containerImage}
                onChange={(e) => setContainerImage(e.target.value)}
                placeholder={VLLM_IMAGE_DEFAULT}
              />
              <NumberInput
                label="GPU count"
                size="xs"
                min={1}
                max={8}
                value={gpuCount}
                onChange={(v) => setGpuCount(Number(v) || 1)}
              />
              <NumberInput
                label="System volume (GB)"
                size="xs"
                min={
                  effectiveMinContainerDiskGb != null
                    ? Math.max(20, effectiveMinContainerDiskGb)
                    : 20
                }
                value={containerDiskInGb}
                onChange={(v) => {
                  const n = Number(v) || 20;
                  const min =
                    effectiveMinContainerDiskGb != null
                      ? Math.max(20, effectiveMinContainerDiskGb)
                      : 20;
                  setContainerDiskInGb(Math.max(min, n));
                  if (vllmModel)
                    saveModelSettings(vllmModel, {
                      containerDiskInGb: Math.max(min, n),
                    });
                }}
              />
              <NumberInput
                label="Data volume (GB)"
                size="xs"
                min={0}
                value={volumeInGb}
                onChange={(v) => {
                  const n = Math.max(0, Number(v) || 0);
                  setVolumeInGb(n);
                  if (vllmModel)
                    saveModelSettings(vllmModel, { volumeInGb: n });
                }}
              />
              {selectedGpu && (
                <Paper withBorder p="xs" bg="dimmed">
                  <Text size="xs" c="dimmed">
                    Est. cost
                  </Text>
                  <Text size="sm" fw={600}>
                    {calculateEstimatedCost() != null
                      ? `$${calculateEstimatedCost()!.toFixed(2)}/hr`
                      : '—'}
                  </Text>
                </Paper>
              )}
              <Group justify="flex-end" mt="xs">
                <Button
                  variant="subtle"
                  size="sm"
                  onClick={() => setCreateModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveConfig}
                  loading={saveRunpodTemplateMutation.isPending}
                  disabled={!selectedGpu || !vllmModel}
                >
                  Save Config
                </Button>
              </Group>
            </Stack>
          </Grid.Col>

          {/* Col 3: vLLM configuration */}
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Stack gap="sm">
              <Text size="sm" fw={600} c="dimmed">
                vLLM configuration
              </Text>
              <Box>
                <Text size="xs" fw={500} mb={4}>
                  Context window:{' '}
                  {(gpuCount > 1
                    ? contextLenForGpuCount(maxModelLen, gpuCount)
                    : maxModelLen
                  ).toLocaleString()}
                  {selectedModelMetadata?.config?._extracted
                    ?.maxContextWindow != null && (
                    <Text component="span" size="xs" c="dimmed" ml={4}>
                      (max:{' '}
                      {Number(
                        selectedModelMetadata.config._extracted.maxContextWindow
                      ).toLocaleString()}
                      )
                    </Text>
                  )}
                </Text>
                <Slider
                  size="sm"
                  min={512}
                  max={maxContextWindowLimit}
                  step={512}
                  value={
                    gpuCount > 1
                      ? contextLenForGpuCount(maxModelLen, gpuCount)
                      : maxModelLen
                  }
                  onChange={(v) => {
                    const rounded =
                      gpuCount > 1 ? contextLenForGpuCount(v, gpuCount) : v;
                    setMaxModelLen(rounded);
                    if (vllmModel)
                      saveModelSettings(vllmModel, { maxModelLen: rounded });
                  }}
                />
              </Box>
              <Box>
                <Group justify="space-between" mb={4}>
                  <Text size="xs" fw={500}>
                    vLLM arguments
                  </Text>
                  {suggestedVllmArgs && (
                    <Button
                      size="xs"
                      variant="subtle"
                      compact
                      onClick={() => {
                        const newArgs = vllmArgs
                          ? `${vllmArgs} ${suggestedVllmArgs}`
                          : suggestedVllmArgs;
                        setVllmArgs(newArgs);
                        if (vllmModel) {
                          saveVllmArgsForModel(vllmModel, newArgs);
                          saveModelSettings(vllmModel, { vllmArgs: newArgs });
                        }
                      }}
                    >
                      Apply suggested
                    </Button>
                  )}
                </Group>
                <TextInput
                  size="xs"
                  placeholder="--trust-remote-code --dtype bfloat16"
                  value={vllmArgs}
                  onChange={(e) => {
                    const v = e.target.value;
                    setVllmArgs(v);
                    if (vllmModel) {
                      saveVllmArgsForModel(vllmModel, v);
                      saveModelSettings(vllmModel, { vllmArgs: v });
                    }
                  }}
                />
              </Box>
              <Accordion variant="separated">
                <Accordion.Item value="vllm-opts">
                  <Accordion.Control>vLLM options</Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="xs">
                      <Switch
                        label="Enable tool auto-choice"
                        size="xs"
                        checked={enableTools}
                        onChange={(e) => {
                          const v = e.currentTarget.checked;
                          setEnableTools(v);
                          if (vllmModel)
                            saveModelSettings(vllmModel, { enableTools: v });
                        }}
                      />
                      <Select
                        label="Tool call parser"
                        size="xs"
                        data={TOOL_PARSER_OPTIONS}
                        value={toolParser}
                        onChange={(v) => {
                          const s = v ?? '';
                          setToolParser(s);
                          if (vllmModel)
                            saveModelSettings(vllmModel, { toolParser: s });
                        }}
                        disabled={!enableTools}
                      />
                      <Switch
                        label="Auto tool choice"
                        size="xs"
                        checked={autoToolChoice}
                        onChange={(e) => {
                          const v = e.currentTarget.checked;
                          setAutoToolChoice(v);
                          if (vllmModel)
                            saveModelSettings(vllmModel, { autoToolChoice: v });
                        }}
                      />
                      <Select
                        label="Data type (dtype)"
                        size="xs"
                        data={DTYPE_OPTIONS}
                        value={dtype}
                        onChange={(v) => {
                          const s = v ?? 'auto';
                          setDtype(s);
                          if (vllmModel)
                            saveModelSettings(vllmModel, { dtype: s });
                        }}
                      />
                      <Switch
                        label="Trust remote code"
                        size="xs"
                        checked={trustRemoteCode}
                        onChange={(e) => {
                          const v = e.currentTarget.checked;
                          setTrustRemoteCode(v);
                          if (vllmModel)
                            saveModelSettings(vllmModel, {
                              trustRemoteCode: v,
                            });
                        }}
                      />
                      <Box>
                        <Text size="xs" fw={500} mb={4}>
                          GPU memory utilization: {gpuMemoryUtilization}%
                        </Text>
                        <Slider
                          size="sm"
                          min={50}
                          max={99}
                          value={gpuMemoryUtilization}
                          onChange={(v) => {
                            setGpuMemoryUtilization(v);
                            if (vllmModel)
                              saveModelSettings(vllmModel, {
                                gpuMemoryUtilization: v,
                              });
                          }}
                        />
                      </Box>
                      <NumberInput
                        label="Seed"
                        size="xs"
                        min={0}
                        placeholder="Random"
                        value={seed}
                        onChange={(v) => {
                          const n = v === '' ? '' : Number(v);
                          setSeed(n);
                          if (vllmModel && typeof n === 'number')
                            saveModelSettings(vllmModel, { seed: n });
                        }}
                      />
                      <Switch
                        label="Enforce eager (no CUDA graph)"
                        size="xs"
                        checked={enforceEager}
                        onChange={(e) => {
                          const v = e.currentTarget.checked;
                          setEnforceEager(v);
                          if (vllmModel)
                            saveModelSettings(vllmModel, { enforceEager: v });
                        }}
                      />
                      <Switch
                        label="Disable log stats"
                        size="xs"
                        checked={disableLogStats}
                        onChange={(e) => {
                          const v = e.currentTarget.checked;
                          setDisableLogStats(v);
                          if (vllmModel)
                            saveModelSettings(vllmModel, {
                              disableLogStats: v,
                            });
                        }}
                      />
                      <TextInput
                        label="Generation config (JSON or preset)"
                        size="xs"
                        placeholder="default"
                        value={generationConfig}
                        onChange={(e) => {
                          const v = e.target.value;
                          setGenerationConfig(v);
                          if (vllmModel)
                            saveModelSettings(vllmModel, {
                              generationConfig: v || undefined,
                            });
                        }}
                      />
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
              <Box mt="xs">
                <Text size="xs" fw={500} c="dimmed" mb={4}>
                  vLLM command preview
                </Text>
                <Text
                  component="pre"
                  size="xs"
                  style={{
                    fontFamily: '"Atkinson Hyperlegible", sans-serif',
                    fontSize: 11,
                    overflowX: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    margin: 0,
                  }}
                >
                  {vllmCommandPreview}
                </Text>
              </Box>
            </Stack>
          </Grid.Col>
        </Grid>
      </Modal>

      <Modal
        opened={hfTokenModalOpen}
        onClose={() => setHfTokenModalOpen(false)}
        title="HuggingFace token"
      >
        <Stack gap="md">
          <PasswordInput
            label="Token"
            placeholder="hf_..."
            description="Stored locally only. Used for gated models and Hugging Face API."
            value={hfTokenEditValue}
            onChange={(e) => setHfTokenEditValue(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setHfTokenModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => saveHfToken(hfTokenEditValue)}>Save</Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
}
