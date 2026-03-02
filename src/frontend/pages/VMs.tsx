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

import { useState } from 'react';
import { trpc } from '../../client/trpc';
import {
  Paper,
  Stack,
  TextInput,
  Button,
  Alert,
  Group,
  Badge,
  Text,
  Select,
  Card,
  Table,
  ScrollArea,
  Loader,
  Modal,
  ActionIcon,
} from '@mantine/core';
import {
  IconPlayerPlay,
  IconPlayerStop,
  IconTrash,
  IconServer,
  IconCloud,
  IconBox,
  IconCheck,
  IconX,
} from '@tabler/icons-react';

type VMInfo = {
  id: string;
  name: string;
  provider: string;
  status: 'pending' | 'running' | 'stopped' | 'error' | 'exited';
  createdAt: string;
  endpoint?: string;
  ports?: Record<string, number>;
  error?: string;
  agentStatus?: 'connected' | 'disconnected' | 'connecting' | 'unknown';
};

const PROVIDER_OPTIONS = [
  { value: 'docker', label: 'Docker', icon: <IconBox size={16} /> },
  { value: 'aws', label: 'AWS EC2', icon: <IconCloud size={16} /> },
  { value: 'runpod', label: 'RunPod', icon: <IconServer size={16} /> },
];

function getStatusBadge(status: string) {
  const u = (status || '').toUpperCase();
  switch (u) {
    case 'RUNNING':
      return <Badge color="green">Running</Badge>;
    case 'STOPPED':
    case 'IDLE':
    case 'EXITED':
      return <Badge color="gray">Stopped</Badge>;
    case 'PENDING':
      return <Badge color="yellow">Pending</Badge>;
    case 'ERROR':
      return <Badge color="red">Error</Badge>;
    default:
      return <Badge color="blue">{status}</Badge>;
  }
}

export function VMsPage() {
  const [provider, setProvider] = useState('docker');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newVmName, setNewVmName] = useState('');
  const [newVmConfig, setNewVmConfig] = useState<Record<string, string>>({});

  // Use tRPC query for listing VMs
  const { data: listData, isLoading, error: listError } = trpc.vm.list.useQuery();
  
  // Set VM list from query result
  const vmList = listData?.success && listData.vms ? listData.vms : [];
  
  // Combine errors
  const error = listError?.message || (listData && !listData.success ? listData.error : null);

  const utils = trpc.useUtils();
  
  const createMutation = trpc.vm.provision.useMutation({
    onSuccess: () => {
      utils.vm.list.invalidate();
      setCreateModalOpen(false);
      setNewVmName('');
      setNewVmConfig({});
    },
  });

  const startMutation = trpc.vm.start.useMutation({
    onSuccess: () => {
      utils.vm.list.invalidate();
    },
  });

  const stopMutation = trpc.vm.stop.useMutation({
    onSuccess: () => {
      utils.vm.list.invalidate();
    },
  });

  const deleteMutation = trpc.vm.delete.useMutation({
    onSuccess: () => {
      utils.vm.list.invalidate();
    },
  });

  const injectAgentMutation = trpc.vm.injectAgent.useMutation({
    onSuccess: () => {
      utils.vm.list.invalidate();
    },
  });

  const handleCreateVM = () => {
    if (!newVmName.trim()) {
      return;
    }

    createMutation.mutate({
      provider,
      config: {
        name: newVmName,
        ...newVmConfig,
      },
    });
  };

  const handleStartVM = (vmId: string) => {
    startMutation.mutate({ vmId });
  };

  const handleStopVM = (vmId: string) => {
    stopMutation.mutate({ vmId });
  };

  const handleDeleteVM = (vmId: string) => {
    if (!window.confirm('Are you sure you want to delete this VM?')) return;
    deleteMutation.mutate({ vmId });
  };

  const handleInjectAgent = (vmId: string) => {
    injectAgentMutation.mutate({ vmId });
  };

  const handleConfigChange = (key: string, value: string) => {
    setNewVmConfig((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <Stack p="md" gap="md">
      <Group justify="space-between">
        <Text fw={600} fz="xl">
          VM Management
        </Text>
        <Button onClick={() => setCreateModalOpen(true)}>Create VM</Button>
      </Group>

      {error && (
        <Alert color="red" title="Error" onClose={() => {}}>
          {error}
        </Alert>
      )}

      {/* Provider Selection */}
      <Card withBorder>
        <Group gap="md">
          <Text fw={500}>Provider:</Text>
          <Select
            data={PROVIDER_OPTIONS.map((p) => ({
              value: p.value,
              label: p.label,
              icon: p.icon,
            }))}
            value={provider}
            onChange={(value) => setProvider(value || 'docker')}
            w={200}
          />
        </Group>
      </Card>

      {/* VM List */}
      <Paper withBorder p="md">
        <ScrollArea h={500}>
          {isLoading ? (
            <Group justify="center" py="xl">
              <Loader />
            </Group>
          ) : vmList.length === 0 ? (
            <Group justify="center" py="xl">
              <Text c="dimmed">No VMs found. Create one to get started.</Text>
            </Group>
          ) : (
            <Table highlightOnHover withColumnBorders>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Provider</th>
                  <th>Status</th>
                  <th>Agent Status</th>
                  <th>Created</th>
                  <th>Endpoint</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {vmList.map((vm) => (
                  <tr key={vm.id}>
                    <td>
                      <Group gap="sm">
                        {vm.name}
                      </Group>
                    </td>
                    <td>
                      <Text size="sm">{vm.provider}</Text>
                    </td>
                    <td>{getStatusBadge(vm.status)}</td>
                    <td>
                      {vm.agentStatus === 'connected' ? (
                        <Badge color="green" leftSection={<IconCheck size={12} />}>
                          Connected
                        </Badge>
                      ) : vm.agentStatus === 'disconnected' ? (
                        <Badge color="red" leftSection={<IconX size={12} />}>
                          Disconnected
                        </Badge>
                      ) : vm.agentStatus === 'connecting' ? (
                        <Badge color="yellow">
                          Connecting...
                        </Badge>
                      ) : (
                        <Text size="sm" c="dimmed">Unknown</Text>
                      )}
                    </td>
                    <td>
                      <Text size="sm" c="dimmed">
                        {new Date(vm.createdAt).toLocaleString()}
                      </Text>
                    </td>
                    <td>
                      {vm.endpoint ? (
                        <Text size="sm" c="blue" truncate="end" w={200}>
                          {vm.endpoint}
                        </Text>
                      ) : (
                        <Text size="sm" c="dimmed">-</Text>
                      )}
                    </td>
                    <td>
                      <Group gap="xs">
                        {vm.status === 'stopped' && (
                          <ActionIcon
                            onClick={() => handleStartVM(vm.id)}
                            variant="subtle"
                            color="green"
                            title="Start VM"
                          >
                            <IconPlayerPlay size={16} />
                          </ActionIcon>
                        )}
                        {vm.status === 'running' && (
                          <ActionIcon
                            onClick={() => handleStopVM(vm.id)}
                            variant="subtle"
                            color="yellow"
                            title="Stop VM"
                          >
                            <IconPlayerStop size={16} />
                          </ActionIcon>
                        )}
                        <ActionIcon
                          onClick={() => handleInjectAgent(vm.id)}
                          variant="subtle"
                          color="blue"
                          title="Inject Agent"
                        >
                          <IconServer size={16} />
                        </ActionIcon>
                        <ActionIcon
                          onClick={() => handleDeleteVM(vm.id)}
                          variant="subtle"
                          color="red"
                          title="Delete VM"
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </ScrollArea>
      </Paper>

      {/* Create VM Modal */}
      <Modal
        opened={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Create New VM"
        size="lg"
      >
        <Stack>
          <TextInput
            label="VM Name"
            placeholder="my-vm"
            value={newVmName}
            onChange={(e) => setNewVmName(e.target.value)}
          />

          {/* Provider-specific configuration */}
          {provider === 'docker' && (
            <>
              <TextInput
                label="Docker Image"
                placeholder="ubuntu:latest"
                value={newVmConfig['image'] || ''}
                onChange={(e) => handleConfigChange('image', e.target.value)}
              />
              <TextInput
                label="Container Name"
                placeholder="my-container"
                value={newVmConfig['name'] || ''}
                onChange={(e) => handleConfigChange('name', e.target.value)}
              />
              <TextInput
                label="Ports (e.g., 8000:8000)"
                placeholder="8000:8000"
                value={newVmConfig['ports'] || ''}
                onChange={(e) => handleConfigChange('ports', e.target.value)}
              />
            </>
          )}

          {provider === 'aws' && (
            <>
              <TextInput
                label="Instance Type"
                placeholder="t3.medium"
                value={newVmConfig['instanceType'] || ''}
                onChange={(e) =>
                  handleConfigChange('instanceType', e.target.value)
                }
              />
              <TextInput
                label="AMI ID"
                placeholder="ami-12345678"
                value={newVmConfig['amiId'] || ''}
                onChange={(e) => handleConfigChange('amiId', e.target.value)}
              />
              <TextInput
                label="Region"
                placeholder="us-east-1"
                value={newVmConfig['region'] || ''}
                onChange={(e) => handleConfigChange('region', e.target.value)}
              />
            </>
          )}

          {provider === 'runpod' && (
            <>
              <TextInput
                label="GPU Type"
                placeholder="RTX 3090"
                value={newVmConfig['gpuType'] || ''}
                onChange={(e) => handleConfigChange('gpuType', e.target.value)}
              />
              <TextInput
                label="Image"
                placeholder="runpod/runner:latest"
                value={newVmConfig['image'] || ''}
                onChange={(e) => handleConfigChange('image', e.target.value)}
              />
            </>
          )}

          <Group justify="flex-end">
            <Button variant="outline" onClick={() => setCreateModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateVM}>Create VM</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}