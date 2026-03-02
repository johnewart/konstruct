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
import { Link } from 'react-router-dom';
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
} from '@mantine/core';
import { IconPlus, IconPencil, IconTrash } from '@tabler/icons-react';

const PROVIDER_TYPES = [
  { value: 'openai', label: 'OpenAI / Vast' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'runpod', label: 'RunPod' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'bedrock', label: 'AWS Bedrock' },
];

type Scope = { type: 'global' } | { type: 'project'; projectId: string };

type FormState = {
  scope: Scope;
  name: string;
  type: string;
  secret_ref: string;
  base_url: string;
  default_model: string;
  endpoint: string;
};

const emptyForm: FormState = {
  scope: { type: 'global' },
  name: '',
  type: 'openai',
  secret_ref: '',
  base_url: '',
  default_model: '',
  endpoint: '',
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
  } | null>(null);
  const [removeScope, setRemoveScope] = useState<Scope | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

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

  const openAdd = (scope: Scope) => {
    setEditing(null);
    setForm({ ...emptyForm, scope });
    setFormOpen(true);
  };

  const openEdit = (
    scope: Scope,
    p: { id: string; name: string; type: string; secret_ref?: string; base_url?: string; default_model?: string; endpoint?: string }
  ) => {
    setEditing({
      scope,
      id: p.id,
      name: p.name,
      type: p.type,
      secret_ref: p.secret_ref ?? '',
      base_url: p.base_url ?? '',
      default_model: p.default_model ?? '',
      endpoint: p.endpoint ?? '',
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
        },
      });
    }
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
                    <Table.Th>Secret ref</Table.Th>
                    <Table.Th>Base URL / Endpoint</Table.Th>
                    <Table.Th>Default model</Table.Th>
                    <Table.Th w={80} />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {global.map((p) => (
                    <Table.Tr key={p.id}>
                      <Table.Td><Text size="sm" fw={500}>{p.name}</Text></Table.Td>
                      <Table.Td><Text size="sm">{p.type}</Text></Table.Td>
                      <Table.Td><Text size="sm" c="dimmed" style={{ wordBreak: 'break-all' }}>{p.secret_ref ?? '—'}</Text></Table.Td>
                      <Table.Td><Text size="sm" style={{ wordBreak: 'break-all' }}>{p.base_url ?? p.endpoint ?? '—'}</Text></Table.Td>
                      <Table.Td><Text size="sm">{p.default_model ?? '—'}</Text></Table.Td>
                      <Table.Td>
                        <Group gap="xs">
                          <ActionIcon variant="subtle" size="sm" onClick={() => openEdit({ type: 'global' }, p)} aria-label="Edit">
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
                      <Table.Th>Secret ref</Table.Th>
                      <Table.Th>Base URL / Endpoint</Table.Th>
                      <Table.Th>Default model</Table.Th>
                      <Table.Th w={80} />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {providers.map((p) => (
                      <Table.Tr key={p.id}>
                        <Table.Td><Text size="sm" fw={500}>{p.name}</Text></Table.Td>
                        <Table.Td><Text size="sm">{p.type}</Text></Table.Td>
                        <Table.Td><Text size="sm" c="dimmed" style={{ wordBreak: 'break-all' }}>{p.secret_ref ?? '—'}</Text></Table.Td>
                        <Table.Td><Text size="sm" style={{ wordBreak: 'break-all' }}>{p.base_url ?? p.endpoint ?? '—'}</Text></Table.Td>
                        <Table.Td><Text size="sm">{p.default_model ?? '—'}</Text></Table.Td>
                        <Table.Td>
                          <Group gap="xs">
                            <ActionIcon variant="subtle" size="sm" onClick={() => openEdit({ type: 'project', projectId }, p)} aria-label="Edit">
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
          <TextInput
            label="Secret ref (env:VAR or 1pass:op://...)"
            placeholder="env:OPENAI_API_KEY"
            value={editing ? editing.secret_ref : form.secret_ref}
            onChange={(e) => (editing ? setEditing((x) => x && { ...x, secret_ref: e.target.value }) : setForm((f) => ({ ...f, secret_ref: e.target.value })))}
          />
          <TextInput
            label="Base URL"
            placeholder="https://api.openai.com/v1"
            value={editing ? editing.base_url : form.base_url}
            onChange={(e) => (editing ? setEditing((x) => x && { ...x, base_url: e.target.value }) : setForm((f) => ({ ...f, base_url: e.target.value })))}
          />
          <TextInput
            label="Default model"
            placeholder="gpt-4o-mini"
            value={editing ? editing.default_model : form.default_model}
            onChange={(e) => (editing ? setEditing((x) => x && { ...x, default_model: e.target.value }) : setForm((f) => ({ ...f, default_model: e.target.value })))}
          />
          <TextInput
            label="Endpoint (e.g. RunPod GraphQL URL)"
            placeholder="https://api.runpod.io/graphql"
            value={editing ? editing.endpoint : form.endpoint}
            onChange={(e) => (editing ? setEditing((x) => x && { ...x, endpoint: e.target.value }) : setForm((f) => ({ ...f, endpoint: e.target.value })))}
          />
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button
              onClick={submitForm}
              loading={addMutation.isPending || updateMutation.isPending}
              disabled={editing ? !editing.name.trim() : !form.name.trim()}
            >
              {editing ? 'Save' : 'Add'}
            </Button>
          </Group>
        </Stack>
      </Modal>

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
