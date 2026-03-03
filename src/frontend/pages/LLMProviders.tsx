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

import { useState } from 'react';
import { trpc } from '../../client/trpc';
import {
  Paper,
  Stack,
  TextInput,
  Button,
  Group,
  Text,
  Table,
  Modal,
  ActionIcon,
  Title,
  Select,
  NumberInput,
  Divider,
  Alert,
} from '@mantine/core';
import { IconPlus, IconPencil, IconTrash, IconRefresh } from '@tabler/icons-react';

const PROVIDER_TYPES = [
  { value: 'openai', label: 'OpenAI / Vast' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'runpod', label: 'RunPod' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'bedrock', label: 'AWS Bedrock' },
  { value: 'claude_cli', label: 'Claude CLI (agent)' },
];

type Scope = { type: 'global' } | { type: 'project'; projectId: string };

type ProviderModel = { id: string; name: string; contextWindow?: number };

type FormState = {
  scope: Scope;
  name: string;
  type: string;
  secret_ref: string;
  base_url: string;
  default_model: string;
  endpoint: string;
  aws_profile: string;
  runpod_pod_id: string;
  claude_cli_path: string;
};

const emptyForm: FormState = {
  scope: { type: 'global' },
  name: '',
  type: 'openai',
  secret_ref: '',
  base_url: '',
  default_model: '',
  endpoint: '',
  aws_profile: '',
  runpod_pod_id: '',
  claude_cli_path: '',
};

export function LLMProvidersPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<{
    scope: Scope;
    id: string;
    name: string;
    type: string;
    secret_ref: string;
    base_url: string;
    default_model: string;
    endpoint: string;
    aws_profile: string;
    runpod_pod_id: string;
    claude_cli_path: string;
    models: ProviderModel[];
  } | null>(null);
  const [removeScope, setRemoveScope] = useState<Scope | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [modelForm, setModelForm] = useState<{ name: string; contextWindow: number | '' }>({ name: '', contextWindow: '' });
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [modelModalOpen, setModelModalOpen] = useState(false);

  const { data: providersData, isLoading } = trpc.providerConfig.list.useQuery();
  const { data: projects = [] } = trpc.projects.list.useQuery();
  const utils = trpc.useUtils();

  const addMutation = trpc.providerConfig.add.useMutation({
    onSuccess: () => {
      utils.providerConfig.list.invalidate();
      setFormOpen(false);
      setForm(emptyForm);
    },
  });

  const updateMutation = trpc.providerConfig.update.useMutation({
    onSuccess: () => {
      utils.providerConfig.list.invalidate();
      setFormOpen(false);
      setEditing(null);
    },
  });

  const removeMutation = trpc.providerConfig.remove.useMutation({
    onSuccess: () => {
      utils.providerConfig.list.invalidate();
      setRemoveScope(null);
      setRemoveId(null);
    },
  });

  const addModelMutation = trpc.providerConfig.addModel.useMutation({
    onSuccess: (newModel) => {
      utils.providerConfig.list.invalidate();
      setEditing((e) => (e ? { ...e, models: [...(e.models ?? []), newModel] } : null));
      setModelForm({ name: '', contextWindow: '' });
      setModelModalOpen(false);
    },
  });
  const updateModelMutation = trpc.providerConfig.updateModel.useMutation({
    onSuccess: (updated) => {
      utils.providerConfig.list.invalidate();
      setEditing((e) => (e ? { ...e, models: (e.models ?? []).map((m) => (m.id === updated.id ? updated : m)) } : null));
      setEditingModelId(null);
      setModelModalOpen(false);
    },
  });
  const removeModelMutation = trpc.providerConfig.removeModel.useMutation({
    onSuccess: (_, variables) => {
      utils.providerConfig.list.invalidate();
      setEditing((e) => (e ? { ...e, models: (e.models ?? []).filter((m) => m.id !== variables.modelId) } : null));
      setRemoveModelId(null);
    },
  });
  const refreshModelsMutation = trpc.providerConfig.refreshProviderModels.useMutation({
    onSuccess: (res, variables) => {
      if (res.error) return;
      setEditing((e) => (e ? { ...e, models: res.models } : null));
      utils.providerConfig.list.invalidate();
      updateMutation.mutate({
        scope: variables.scope,
        id: variables.providerId,
        provider: { models: res.models },
      });
    },
  });
  const [removeModelId, setRemoveModelId] = useState<string | null>(null);
  const [refreshModelsError, setRefreshModelsError] = useState<string | null>(null);

  const openAdd = (scope: Scope) => {
    setEditing(null);
    setForm({ ...emptyForm, scope });
    setFormOpen(true);
  };

  const isRunpodForm = formOpen && ((editing?.type ?? form.type) === 'runpod');
  const { data: runpodPodsData, isLoading: runpodPodsLoading, error: runpodPodsError } = trpc.runpod.listPodsForProvider.useQuery(
    undefined,
    { enabled: isRunpodForm }
  );
  const runpodPods = runpodPodsData?.success && runpodPodsData.pods
    ? runpodPodsData.pods.map((p) => ({ id: p.id, name: p.name || p.id, status: p.status ?? '' }))
    : [];

  const openEdit = (
    scope: Scope,
    p: { id: string; name: string; type: string; secret_ref?: string; base_url?: string; default_model?: string; endpoint?: string; aws_profile?: string; runpod_pod_id?: string; claude_cli_path?: string; models?: ProviderModel[] }
  ) => {
    setRefreshModelsError(null);
    setEditing({
      scope,
      id: p.id,
      name: p.name,
      type: p.type,
      secret_ref: p.secret_ref ?? '',
      base_url: p.base_url ?? '',
      default_model: p.default_model ?? '',
      endpoint: p.endpoint ?? '',
      aws_profile: p.aws_profile ?? '',
      runpod_pod_id: p.runpod_pod_id ?? '',
      claude_cli_path: p.claude_cli_path ?? '',
      models: p.models ?? [],
    });
    setFormOpen(true);
  };

  const submitForm = () => {
    if (editing) {
      updateMutation.mutate({
        scope: editing.scope,
        id: editing.id,
        provider: {
          name: editing.name.trim(),
          type: editing.type,
          secret_ref: editing.secret_ref.trim() || undefined,
          base_url: editing.base_url.trim() || undefined,
          default_model: editing.default_model.trim() || undefined,
          endpoint: editing.endpoint.trim() || undefined,
          aws_profile: editing.aws_profile.trim() || undefined,
          runpod_pod_id: editing.runpod_pod_id.trim() || undefined,
          claude_cli_path: editing.claude_cli_path.trim() || undefined,
          models: editing.models ?? [],
        },
      });
    } else {
      addMutation.mutate({
        scope: form.scope,
        provider: {
          name: form.name.trim(),
          type: form.type,
          secret_ref: form.secret_ref.trim() || undefined,
          base_url: form.base_url.trim() || undefined,
          default_model: form.default_model.trim() || undefined,
          endpoint: form.endpoint.trim() || undefined,
          aws_profile: form.aws_profile.trim() || undefined,
          runpod_pod_id: form.runpod_pod_id.trim() || undefined,
          claude_cli_path: form.claude_cli_path.trim() || undefined,
        },
      });
    }
  };

  const saveModel = () => {
    if (!editing) return;
    if (editingModelId) {
      updateModelMutation.mutate({
        scope: editing.scope,
        providerId: editing.id,
        modelId: editingModelId,
        model: { name: modelForm.name.trim(), contextWindow: modelForm.contextWindow === '' ? undefined : modelForm.contextWindow },
      });
    } else {
      addModelMutation.mutate({
        scope: editing.scope,
        providerId: editing.id,
        model: { name: modelForm.name.trim(), contextWindow: modelForm.contextWindow === '' ? undefined : modelForm.contextWindow },
      });
    }
  };

  const openAddModel = () => {
    setEditingModelId(null);
    setModelForm({ name: '', contextWindow: '' });
    setModelModalOpen(true);
  };
  const openEditModel = (m: ProviderModel) => {
    setEditingModelId(m.id);
    setModelForm({ name: m.name, contextWindow: m.contextWindow ?? '' });
    setModelModalOpen(true);
  };

  const handleRemove = () => {
    if (removeScope && removeId) removeMutation.mutate({ scope: removeScope, id: removeId });
  };

  const global = providersData?.global ?? [];
  const byProject = providersData?.projects ?? [];

  return (
    <Stack p="md" maw={960} mx="auto">
      <Group justify="space-between" align="center">
        <Title order={3}>LLM Providers</Title>
      </Group>

      <Text size="sm" c="dimmed">
        Global providers are available everywhere. Project providers apply only to that
        project and override global when both exist.
      </Text>

      {isLoading ? (
        <Text size="sm" c="dimmed">Loading…</Text>
      ) : (
        <>
          <Paper p="md" withBorder>
            <Group justify="space-between" mb="sm">
              <Title order={5}>Global</Title>
              <Button
                leftSection={<IconPlus size={14} />}
                variant="light"
                size="xs"
                onClick={() => openAdd({ type: 'global' })}
              >
                Add provider
              </Button>
            </Group>
            {global.length === 0 ? (
              <Text size="sm" c="dimmed">No global providers. Add one to get started.</Text>
            ) : (
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Name</Table.Th>
                    <Table.Th>Type</Table.Th>
                    <Table.Th>Credentials / Profile</Table.Th>
                    <Table.Th>Base URL / Endpoint</Table.Th>
                    <Table.Th>Default model</Table.Th>
                    <Table.Th>Models</Table.Th>
                    <Table.Th w={80} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {global.map((p) => (
                    <Table.Tr key={p.id}>
                      <Table.Td><Text size="sm" fw={500}>{p.name}</Text></Table.Td>
                      <Table.Td><Text size="sm">{p.type}</Text></Table.Td>
                      <Table.Td><Text size="sm" c="dimmed" style={{ wordBreak: 'break-all' }}>{(p as { claude_cli_path?: string }).claude_cli_path ?? (p as { runpod_pod_id?: string }).runpod_pod_id ?? (p as { aws_profile?: string }).aws_profile ?? p.secret_ref ?? '—'}</Text></Table.Td>
                      <Table.Td><Text size="sm" style={{ wordBreak: 'break-all' }}>{p.base_url ?? p.endpoint ?? '—'}</Text></Table.Td>
                      <Table.Td><Text size="sm">{p.default_model ?? '—'}</Text></Table.Td>
                      <Table.Td><Text size="sm">{(p as { models?: unknown[] }).models?.length ?? 0}</Text></Table.Td>
                      <Table.Td>
                        <Group gap="xs">
                          <ActionIcon variant="subtle" size="sm" onClick={() => openEdit({ type: 'global' }, p as Parameters<typeof openEdit>[1])} aria-label="Edit">
                            <IconPencil size={14} />
                          </ActionIcon>
                          <ActionIcon variant="subtle" size="sm" color="red" onClick={() => { setRemoveScope({ type: 'global' }); setRemoveId(p.id); }} aria-label="Remove">
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Paper>

          {byProject.map(({ projectId, projectName, path, providers }) => (
            <Paper key={projectId} p="md" withBorder>
              <Group justify="space-between" mb="sm">
                <div>
                  <Title order={5}>{projectName}</Title>
                  <Text size="xs" c="dimmed">{path}</Text>
                </div>
                <Button
                  leftSection={<IconPlus size={14} />}
                  variant="light"
                  size="xs"
                  onClick={() => openAdd({ type: 'project', projectId })}
                >
                  Add provider
                </Button>
              </Group>
              {providers.length === 0 ? (
                <Text size="sm" c="dimmed">No project-specific providers.</Text>
              ) : (
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Name</Table.Th>
                      <Table.Th>Type</Table.Th>
                      <Table.Th>Credentials / Profile</Table.Th>
                      <Table.Th>Base URL / Endpoint</Table.Th>
                      <Table.Th>Default model</Table.Th>
                      <Table.Th>Models</Table.Th>
                      <Table.Th w={80} />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {providers.map((p) => (
                      <Table.Tr key={p.id}>
                        <Table.Td><Text size="sm" fw={500}>{p.name}</Text></Table.Td>
                        <Table.Td><Text size="sm">{p.type}</Text></Table.Td>
                        <Table.Td><Text size="sm" c="dimmed" style={{ wordBreak: 'break-all' }}>{(p as { claude_cli_path?: string }).claude_cli_path ?? (p as { runpod_pod_id?: string }).runpod_pod_id ?? (p as { aws_profile?: string }).aws_profile ?? p.secret_ref ?? '—'}</Text></Table.Td>
                        <Table.Td><Text size="sm" style={{ wordBreak: 'break-all' }}>{p.base_url ?? p.endpoint ?? '—'}</Text></Table.Td>
                        <Table.Td><Text size="sm">{p.default_model ?? '—'}</Text></Table.Td>
                        <Table.Td><Text size="sm">{(p as { models?: unknown[] }).models?.length ?? 0}</Text></Table.Td>
                        <Table.Td>
                          <Group gap="xs">
                            <ActionIcon variant="subtle" size="sm" onClick={() => openEdit({ type: 'project', projectId }, p as Parameters<typeof openEdit>[1])} aria-label="Edit">
                              <IconPencil size={14} />
                            </ActionIcon>
                            <ActionIcon variant="subtle" size="sm" color="red" onClick={() => { setRemoveScope({ type: 'project', projectId }); setRemoveId(p.id); }} aria-label="Remove">
                              <IconTrash size={14} />
                            </ActionIcon>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Paper>
          ))}
        </>
      )}

      <Modal
        opened={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
          setForm(emptyForm);
        }}
        title={editing ? 'Edit provider' : 'Add provider'}
      >
        <Stack gap="md">
          {!editing && (
            <Select
              label="Scope"
              data={[
                { value: 'global', label: 'Global' },
                ...projects.map((p) => ({ value: `project:${p.id}`, label: `Project: ${p.name}` })),
              ]}
              value={form.scope.type === 'global' ? 'global' : `project:${form.scope.projectId}`}
              onChange={(v) => {
                if (v === 'global') setForm((f) => ({ ...f, scope: { type: 'global' } }));
                else if (v?.startsWith('project:')) setForm((f) => ({ ...f, scope: { type: 'project', projectId: v.slice(8) } }));
              }}
            />
          )}
          {editing && (
            <Text size="sm" c="dimmed">Scope: {editing.scope.type === 'global' ? 'Global' : projects.find((x) => x.id === editing.scope.projectId)?.name ?? editing.scope.projectId}</Text>
          )}
          <TextInput
            label="Name"
            placeholder="My OpenAI"
            value={editing ? editing.name : form.name}
            onChange={(e) => (editing ? setEditing((x) => x && { ...x, name: e.target.value }) : setForm((f) => ({ ...f, name: e.target.value })))}
          />
          <Select
            label="Type"
            data={PROVIDER_TYPES}
            value={editing ? editing.type : form.type}
            onChange={(v) => (v ? (editing ? setEditing((x) => x && { ...x, type: v }) : setForm((f) => ({ ...f, type: v }))) : null)}
          />
          {((editing?.type ?? form.type) === 'bedrock' && (
            <TextInput
              label="AWS profile"
              placeholder="default"
              value={editing ? editing.aws_profile : form.aws_profile}
              onChange={(e) => (editing ? setEditing((x) => x && { ...x, aws_profile: e.target.value }) : setForm((f) => ({ ...f, aws_profile: e.target.value })))}
            />
          ))}
          {(['openai', 'anthropic'].includes(editing?.type ?? form.type) && (
            <TextInput
              label="Secret ref (env:VAR or 1pass:op://...)"
              placeholder={editing?.type === 'anthropic' || form.type === 'anthropic' ? 'env:ANTHROPIC_API_KEY' : 'env:OPENAI_API_KEY'}
              value={editing ? editing.secret_ref : form.secret_ref}
              onChange={(e) => (editing ? setEditing((x) => x && { ...x, secret_ref: e.target.value }) : setForm((f) => ({ ...f, secret_ref: e.target.value })))}
            />
          ))}
          {(['openai', 'ollama'].includes(editing?.type ?? form.type) && (
            <TextInput
              label="Base URL"
              placeholder="https://api.openai.com/v1"
              value={editing ? editing.base_url : form.base_url}
              onChange={(e) => (editing ? setEditing((x) => x && { ...x, base_url: e.target.value }) : setForm((f) => ({ ...f, base_url: e.target.value })))}
            />
          ))}
          {((editing?.type ?? form.type) === 'claude_cli') && (
            <TextInput
              label="Claude CLI path"
              placeholder="/path/to/claude or leave empty for default"
              description="Path to the Claude Code CLI binary (e.g. from nvm: $NVM_BIN/claude)"
              value={editing ? editing.claude_cli_path : form.claude_cli_path}
              onChange={(e) => (editing ? setEditing((x) => x && { ...x, claude_cli_path: e.target.value }) : setForm((f) => ({ ...f, claude_cli_path: e.target.value })))}
            />
          )}
          {(editing?.type ?? form.type) === 'runpod' && (
            <Stack gap="xs">
              <Text size="sm" fw={500}>Select a RunPod pod</Text>
              {runpodPodsLoading && <Text size="sm" c="dimmed">Loading pods…</Text>}
              {runpodPodsError && (
                <Alert color="red" title="Could not load pods">
                  {runpodPodsError.message}
                </Alert>
              )}
              {!runpodPodsLoading && runpodPodsData?.error && (
                <Alert color="yellow" title="RunPod not configured">
                  {runpodPodsData.error}
                </Alert>
              )}
              {(runpodPods.length > 0 || (editing ? editing.runpod_pod_id : form.runpod_pod_id)) && !runpodPodsData?.error && (
                <Select
                  label="Pod"
                  placeholder="Choose a pod"
                  value={editing ? editing.runpod_pod_id : form.runpod_pod_id}
                  onChange={(v) => {
                    const id = v ?? '';
                    if (editing) setEditing((x) => x ? { ...x, runpod_pod_id: id } : null);
                    else setForm((f) => ({ ...f, runpod_pod_id: id }));
                  }}
                  data={[
                    ...(runpodPods.length > 0
                      ? runpodPods.map((p) => ({ value: p.id, label: `${p.name || p.id} (${p.status})` }))
                      : []),
                    ...((editing ? editing.runpod_pod_id : form.runpod_pod_id) && !runpodPods.some((p) => p.id === (editing ? editing.runpod_pod_id : form.runpod_pod_id))
                      ? [{ value: editing ? editing.runpod_pod_id : form.runpod_pod_id, label: `${editing ? editing.runpod_pod_id : form.runpod_pod_id} (saved)` }]
                      : []),
                  ]}
                />
              )}
              {(editing ? editing.runpod_pod_id : form.runpod_pod_id) && (
                <Text size="xs" c="dimmed">
                  URL: https://{(editing ? editing.runpod_pod_id : form.runpod_pod_id)}-8000.proxy.runpod.net/v1
                </Text>
              )}
            </Stack>
          )}
          <TextInput
            label="Default model (optional)"
            placeholder="e.g. gpt-4o-mini"
            value={editing ? editing.default_model : form.default_model}
            onChange={(e) => (editing ? setEditing((x) => x && { ...x, default_model: e.target.value }) : setForm((f) => ({ ...f, default_model: e.target.value })))}
          />
          {editing && (
            <>
              <Divider label="Models" labelPosition="left" />
              {refreshModelsError && (
                <Alert color="red" title="Refresh failed" onClose={() => setRefreshModelsError(null)} withCloseButton>
                  {refreshModelsError}
                </Alert>
              )}
              <Group justify="space-between">
                <Text size="sm" c="dimmed">Model name and context window (for max_tokens)</Text>
                <Group gap="xs">
                  {['openai', 'anthropic', 'bedrock', 'runpod'].includes(editing.type) && (
                    <Button
                      variant="light"
                      size="xs"
                      leftSection={<IconRefresh size={14} />}
                      loading={refreshModelsMutation.isPending}
                      onClick={() => {
                        setRefreshModelsError(null);
                        refreshModelsMutation.mutate(
                          { scope: editing.scope, providerId: editing.id },
                          {
                            onSuccess: (res) => {
                              if (res.error) setRefreshModelsError(res.error);
                            },
                          }
                        );
                      }}
                    >
                      Refresh from API
                    </Button>
                  )}
                  <Button variant="light" size="xs" leftSection={<IconPlus size={14} />} onClick={openAddModel}>
                    Add model
                  </Button>
                </Group>
              </Group>
              {editing.models.length === 0 ? (
                <Text size="sm" c="dimmed">No models. Add one to set context window per model.</Text>
              ) : (
                <Table withTableBorder withColumnBorders>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Name</Table.Th>
                      <Table.Th>Context window</Table.Th>
                      <Table.Th w={80} />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {editing.models.map((m) => (
                      <Table.Tr key={m.id}>
                        <Table.Td><Text size="sm">{m.name}</Text></Table.Td>
                        <Table.Td><Text size="sm">{m.contextWindow ?? '—'}</Text></Table.Td>
                        <Table.Td>
                          <Group gap="xs">
                            <ActionIcon variant="subtle" size="sm" onClick={() => openEditModel(m)} aria-label="Edit model">
                              <IconPencil size={14} />
                            </ActionIcon>
                            <ActionIcon variant="subtle" size="sm" color="red" onClick={() => setRemoveModelId(m.id)} aria-label="Remove model">
                              <IconTrash size={14} />
                            </ActionIcon>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </>
          )}
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button
              onClick={submitForm}
              loading={addMutation.isPending || updateMutation.isPending}
              disabled={
                (editing ? !editing.name.trim() : !form.name.trim()) ||
                ((editing?.type ?? form.type) === 'runpod' && !(editing ? editing.runpod_pod_id : form.runpod_pod_id)?.trim())
              }
            >
              {editing ? 'Save' : 'Add'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={modelModalOpen} onClose={() => { setModelModalOpen(false); setEditingModelId(null); }} title={editingModelId ? 'Edit model' : 'Add model'}>
        <Stack gap="md">
          <TextInput
            label="Model name"
            placeholder="gpt-4o-mini"
            value={modelForm.name}
            onChange={(e) => setModelForm((f) => ({ ...f, name: e.target.value }))}
          />
          <NumberInput
            label="Context window (max_tokens)"
            placeholder="4096"
            min={1}
            value={modelForm.contextWindow === '' ? undefined : modelForm.contextWindow}
            onChange={(v) => setModelForm((f) => ({ ...f, contextWindow: v === '' ? '' : Number(v) }))}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => { setModelModalOpen(false); setEditingModelId(null); }}>Cancel</Button>
            <Button
              onClick={saveModel}
              loading={addModelMutation.isPending || updateModelMutation.isPending}
              disabled={!modelForm.name.trim()}
            >
              {editingModelId ? 'Save' : 'Add'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {removeModelId !== null && editing && (
        <Modal opened onClose={() => setRemoveModelId(null)} title="Remove model">
          <Stack gap="md">
            <Text size="sm">Remove this model from the list? This does not affect the provider.</Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setRemoveModelId(null)}>Cancel</Button>
              <Button
                color="red"
                onClick={() => {
                  removeModelMutation.mutate({ scope: editing.scope, providerId: editing.id, modelId: removeModelId });
                }}
                loading={removeModelMutation.isPending}
              >
                Remove
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}

      <Modal opened={removeId !== null} onClose={() => { setRemoveId(null); setRemoveScope(null); }} title="Remove provider">
        <Stack gap="md">
          <Text size="sm">Remove this provider? This does not delete any secrets.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => { setRemoveId(null); setRemoveScope(null); }}>Cancel</Button>
            <Button color="red" onClick={handleRemove} loading={removeMutation.isPending}>Remove</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
