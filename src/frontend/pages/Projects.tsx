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
} from '@mantine/core';
import { IconPlus, IconPencil, IconTrash } from '@tabler/icons-react';

type ProjectFormState = {
  name: string;
  gitRepositoryUrl: string;
  path: string;
};

const emptyForm: ProjectFormState = {
  name: '',
  gitRepositoryUrl: '',
  path: '',
};

export function ProjectsPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProjectFormState>(emptyForm);
  const [removeId, setRemoveId] = useState<string | null>(null);

  const { data: projects = [], isLoading } = trpc.projects.list.useQuery();
  const utils = trpc.useUtils();

  const addMutation = trpc.projects.add.useMutation({
    onSuccess: () => {
      utils.projects.list.invalidate();
      setFormOpen(false);
      setForm(emptyForm);
    },
  });

  const updateMutation = trpc.projects.update.useMutation({
    onSuccess: () => {
      utils.projects.list.invalidate();
      setFormOpen(false);
      setEditingId(null);
      setForm(emptyForm);
    },
  });

  const removeMutation = trpc.projects.remove.useMutation({
    onSuccess: () => {
      utils.projects.list.invalidate();
      setRemoveId(null);
    },
  });

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
  };

  const openEdit = (id: string) => {
    const p = projects.find((x) => x.id === id);
    if (!p) return;
    setEditingId(id);
    setForm({
      name: p.name,
      gitRepositoryUrl: p.gitRepositoryUrl,
      path: p.location.type === 'local' ? p.location.path : '',
    });
    setFormOpen(true);
  };

  const submitForm = () => {
    if (editingId) {
      updateMutation.mutate({
        id: editingId,
        name: form.name.trim(),
        gitRepositoryUrl: form.gitRepositoryUrl.trim(),
        location: { type: 'local' as const, path: form.path.trim() },
      });
    } else {
      addMutation.mutate({
        name: form.name.trim(),
        gitRepositoryUrl: form.gitRepositoryUrl.trim(),
        location: { type: 'local' as const, path: form.path.trim() },
      });
    }
  };

  const handleRemove = () => {
    if (removeId) removeMutation.mutate({ id: removeId });
  };

  return (
    <Stack p="md" maw={900} mx="auto">
      <Group justify="space-between" align="center">
        <Title order={3}>Projects</Title>
        <Group>
          <Button
            leftSection={<IconPlus size={16} />}
            variant="light"
            size="sm"
            onClick={openAdd}
          >
            Add project
          </Button>
        </Group>
      </Group>

      <Paper p="md" withBorder>
        <Text size="sm" c="dimmed" mb="sm">
          Projects Konstruct knows about. Each has a name, git repository URL, and a
          local path. (VM locations can be added later.)
        </Text>
        {isLoading ? (
          <Text size="sm" c="dimmed">
            Loading…
          </Text>
        ) : projects.length === 0 ? (
          <Text size="sm" c="dimmed">
            No projects yet. Click &quot;Add project&quot; to add one.
          </Text>
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Git URL</Table.Th>
                <Table.Th>Location</Table.Th>
                <Table.Th w={80} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {projects.map((p) => (
                <Table.Tr key={p.id}>
                  <Table.Td>
                    <Text fw={500} size="sm">
                      {p.name}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed" style={{ wordBreak: 'break-all' }}>
                      {p.gitRepositoryUrl}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">
                      {p.location.type === 'local'
                        ? p.location.path
                        : `${p.location.type}: ${(p.location as { path?: string }).path ?? '—'}`}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        onClick={() => openEdit(p.id)}
                        aria-label="Edit"
                      >
                        <IconPencil size={14} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        color="red"
                        onClick={() => setRemoveId(p.id)}
                        aria-label="Remove"
                      >
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

      <Modal
        opened={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditingId(null);
          setForm(emptyForm);
        }}
        title={editingId ? 'Edit project' : 'Add project'}
      >
        <Stack gap="md">
          <TextInput
            label="Name"
            placeholder="My project"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <TextInput
            label="Git repository URL"
            placeholder="https://github.com/org/repo.git"
            value={form.gitRepositoryUrl}
            onChange={(e) =>
              setForm((f) => ({ ...f, gitRepositoryUrl: e.target.value }))
            }
          />
          <TextInput
            label="Local path"
            placeholder="/path/to/repo"
            value={form.path}
            onChange={(e) => setForm((f) => ({ ...f, path: e.target.value }))}
          />
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={submitForm}
              loading={addMutation.isPending || updateMutation.isPending}
              disabled={!form.name.trim() || !form.gitRepositoryUrl.trim() || !form.path.trim()}
            >
              {editingId ? 'Save' : 'Add'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={removeId !== null}
        onClose={() => setRemoveId(null)}
        title="Remove project"
      >
        <Stack gap="md">
          <Text size="sm">
            Remove this project from the list? This does not delete any files on disk.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRemoveId(null)}>
              Cancel
            </Button>
            <Button
              color="red"
              onClick={handleRemove}
              loading={removeMutation.isPending}
            >
              Remove
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
