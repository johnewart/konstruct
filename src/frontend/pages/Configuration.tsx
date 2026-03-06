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

import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Stack, Text, Card, Button, Grid, Box, Switch, Group, Modal, Loader } from '@mantine/core';
import { useProjectModel } from '../contexts/ProjectModelContext';
import { getPluginSettingsLoader } from '../plugins/registry';
import type { PluginSettingsProps } from '../plugins/registry';
import { RunPodPage } from './RunPod';
import { VMsPage } from './VMs';
import { ProjectsPage } from './Projects';
import { LLMProvidersPage } from './LLMProviders';
import { GitHubConfigPage } from './GitHubConfig';
import { AssistantInstructionsPage } from './AssistantInstructionsPage';
import { trpc } from '../../client/trpc';

const TAB_KEY = 'tab';
const SECTIONS = [
  { id: 'general', label: 'General Settings', description: 'Overview and navigation' },
  { id: 'runpod', label: 'RunPod', description: 'Configure RunPod GPU pods' },
  { id: 'vms', label: 'VMs', description: 'Virtual machines' },
  { id: 'projects', label: 'Projects', description: 'Workspace projects' },
  { id: 'providers', label: 'Providers', description: 'LLM providers' },
  { id: 'assistants', label: 'Assistants', description: 'Mode instructions' },
  { id: 'github', label: 'GitHub', description: 'GitHub integration' },
  { id: 'code', label: 'Code', description: 'Code graph and cache' },
  { id: 'plugins', label: 'Plugins', description: 'Enabled plugins' },
  { id: 'tools', label: 'Tools', description: 'All known tools' },
] as const;
type TabValue = (typeof SECTIONS)[number]['id'];

function isValidTab(v: string): v is TabValue {
  return SECTIONS.some((s) => s.id === v);
}

function GeneralSettingsSection() {
  const { data: runpodData, isLoading: runpodLoading } = trpc.providerConfig.getRunpodManagementEnabled.useQuery();
  const setRunpodEnabled = trpc.providerConfig.setRunpodManagementEnabled.useMutation();
  const { data: vmData, isLoading: vmLoading } = trpc.providerConfig.getVmManagementEnabled.useQuery();
  const setVmEnabled = trpc.providerConfig.setVmManagementEnabled.useMutation();
  const utils = trpc.useUtils();
  const runpodEnabled = runpodData?.enabled ?? false;
  const vmEnabled = vmData?.enabled ?? false;

  const handleRunpodChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.currentTarget.checked;
    setRunpodEnabled.mutate(
      { enabled: next },
      { onSuccess: () => void utils.providerConfig.getRunpodManagementEnabled.invalidate() }
    );
  };

  const handleVmChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.currentTarget.checked;
    setVmEnabled.mutate(
      { enabled: next },
      { onSuccess: () => void utils.providerConfig.getVmManagementEnabled.invalidate() }
    );
  };

  return (
    <Stack gap="md">
      <Text fw={600} size="sm">
        Settings
      </Text>
      <Text size="sm" c="dimmed">
        Use the menu on the left to switch between sections. Enable the toggles below to show RunPod and VMs in the sidebar.
      </Text>
      <Group justify="space-between">
        <Text size="sm" fw={500}>
          Enable RunPod management
        </Text>
        <Switch
          key={`runpod-enabled-${runpodEnabled}`}
          size="md"
          defaultChecked={runpodEnabled}
          disabled={runpodLoading}
          onChange={handleRunpodChange}
          aria-label="Enable RunPod management"
        />
      </Group>
      <Group justify="space-between">
        <Text size="sm" fw={500}>
          Enable VMs management
        </Text>
        <Switch
          key={`vm-enabled-${vmEnabled}`}
          size="md"
          defaultChecked={vmEnabled}
          disabled={vmLoading}
          onChange={handleVmChange}
          aria-label="Enable VMs management"
        />
      </Group>
      <Text size="sm">
        <Link to="/" style={{ color: 'var(--app-text)', textDecoration: 'none' }}>
          ← Back to Chat
        </Link>
      </Text>
    </Stack>
  );
}

function PluginsSection() {
  const { projectId } = useProjectModel();
  const effectiveProjectId = projectId ?? '_default';
  const [settingsPluginId, setSettingsPluginId] = useState<string | null>(null);

  const { data, isLoading } = trpc.plugins.listAvailable.useQuery();
  const setPluginEnabled = trpc.plugins.setPluginEnabled.useMutation();
  const utils = trpc.useUtils();
  const plugins = data?.plugins ?? [];

  const { data: settingsData } = trpc.plugins.getPluginSettings.useQuery(
    { projectId: effectiveProjectId, pluginId: settingsPluginId! },
    { enabled: !!settingsPluginId }
  );
  const setPluginSettings = trpc.plugins.setPluginSettings.useMutation();

  const handleToggle = (pluginId: string, enabled: boolean) => {
    setPluginEnabled.mutate(
      { pluginId, enabled },
      {
        onSuccess: () => {
          void utils.plugins.listAvailable.invalidate();
          void utils.plugins.getRestartNeeded.invalidate();
        },
      }
    );
  };

  const handleOpenSettings = (pluginId: string) => setSettingsPluginId(pluginId);
  const handleCloseSettings = () => setSettingsPluginId(null);

  return (
    <Stack gap="md">
      <Text fw={600} size="sm">
        Plugins
      </Text>
      <Text size="sm" c="dimmed">
        Enable or disable plugins and configure per-workspace settings. Changes to enabled list take effect after restart.
      </Text>
      {isLoading ? (
        <Text size="sm" c="dimmed">Loading…</Text>
      ) : plugins.length === 0 ? (
        <Text size="sm" c="dimmed">No plugins installed. Add packages like <code>konstruct-plugin-example</code> to get started.</Text>
      ) : (
        <Stack gap="xs">
          {plugins.map((p) => (
            <Card key={p.id} withBorder padding="sm" radius="md">
              <Group justify="space-between" wrap="nowrap">
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Text fw={500} size="sm">{p.name}</Text>
                  {p.description && (
                    <Text size="xs" c="dimmed" mt={4} lineClamp={2}>{p.description}</Text>
                  )}
                  <Text size="xs" c="dimmed" mt={2}>ID: {p.id}{p.loaded ? ' · loaded' : p.enabled ? ' · will load on restart' : ''}</Text>
                </Box>
                <Group gap="xs" wrap="nowrap">
                  <Button
                    variant="light"
                    size="xs"
                    onClick={() => handleOpenSettings(p.id)}
                    aria-label={`Settings for ${p.name}`}
                  >
                    Settings
                  </Button>
                  <Switch
                    size="md"
                    checked={p.enabled}
                    onChange={(e) => handleToggle(p.id, e.currentTarget.checked)}
                    aria-label={`Enable ${p.name}`}
                  />
                </Group>
              </Group>
            </Card>
          ))}
        </Stack>
      )}

      {settingsPluginId && (
        <PluginSettingsModal
          pluginId={settingsPluginId}
          projectId={effectiveProjectId}
          settings={settingsData?.settings ?? {}}
          onSave={(settings) => {
            setPluginSettings.mutate(
              { projectId: effectiveProjectId, pluginId: settingsPluginId, settings },
              {
                onSuccess: () => {
                  void utils.plugins.getPluginSettings.invalidate();
                },
              }
            );
          }}
          onClose={handleCloseSettings}
        />
      )}
    </Stack>
  );
}

function PluginSettingsModal({
  pluginId,
  projectId,
  settings,
  onSave,
  onClose,
}: PluginSettingsProps & { onClose: () => void }) {
  const [Component, setComponent] = useState<React.ComponentType<PluginSettingsProps> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    setComponent(null);
    const load = getPluginSettingsLoader(pluginId);
    load()
      .then((m) => (m?.default ? setComponent(() => m.default) : setErr('No settings panel for this plugin')))
      .catch((e) => setErr(e?.message?.includes('Cannot find module') ? 'No settings panel for this plugin' : (e?.message ?? 'Failed to load settings')));
  }, [pluginId]);

  const handleSave = (next: Record<string, unknown>) => {
    onSave(next);
  };

  return (
    <Modal
      opened
      onClose={onClose}
      title={`Plugin settings: ${pluginId}`}
      size="md"
    >
      {err && <Text size="sm" c="red">{err}</Text>}
      {!err && !Component && <Loader size="sm" />}
      {!err && Component && (
        <Component
          pluginId={pluginId}
          projectId={projectId}
          settings={settings}
          onSave={handleSave}
        />
      )}
    </Modal>
  );
}

function ToolsSection() {
  const { data, isLoading } = trpc.tools.listAll.useQuery();
  const tools = data?.tools ?? [];
  return (
    <Stack gap="md">
      <Text fw={600} size="sm">
        Tools
      </Text>
      <Text size="sm" c="dimmed">
        All tools available to the agent (core and from plugins). Modes expose a subset of these.
      </Text>
      {isLoading ? (
        <Text size="sm" c="dimmed">Loading…</Text>
      ) : tools.length === 0 ? (
        <Text size="sm" c="dimmed">No tools.</Text>
      ) : (
        <Stack gap="xs">
          {tools.map((t) => (
            <Card key={t.name} withBorder padding="sm" radius="md">
              <Text fw={500} size="sm">{t.name}</Text>
              {t.description && (
                <Text size="xs" c="dimmed" mt={4}>{t.description}</Text>
              )}
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function CodeConfigSection() {
  const clearCaches = trpc.codebase.clearAllDependencyGraphCaches.useMutation();
  return (
    <Stack gap="md">
      <Card withBorder padding="md" radius="md">
        <Text fw={600} size="sm" mb="xs">
          Dependency graph cache
        </Text>
        <Text size="sm" c="dimmed" mb="md">
          The dependency graph (Code explorer, PR related files) is cached for about an hour. Clear all caches to force a fresh build on next view.
        </Text>
        <Button
          variant="light"
          size="sm"
          loading={clearCaches.isPending}
          onClick={() => clearCaches.mutate(undefined)}
        >
          Clear all dependency graph caches
        </Button>
        {clearCaches.isSuccess && (
          <Text size="sm" c="dimmed" mt="sm">
            Cleared {clearCaches.data?.cleared ?? 0} cache entries.
          </Text>
        )}
      </Card>
    </Stack>
  );
}

export function ConfigurationPage() {
  const [searchParams] = useSearchParams();
  const tab = searchParams.get(TAB_KEY);
  const activeTab = isValidTab(tab ?? '') ? tab : 'general';
  const { data: runpodEnabledData } = trpc.providerConfig.getRunpodManagementEnabled.useQuery();
  const { data: vmEnabledData } = trpc.providerConfig.getVmManagementEnabled.useQuery();
  const runpodManagementEnabled = runpodEnabledData?.enabled === true;
  const vmManagementEnabled = vmEnabledData?.enabled === true;
  const visibleSections = SECTIONS.filter(
    (s) =>
      (s.id !== 'runpod' || runpodManagementEnabled) &&
      (s.id !== 'vms' || vmManagementEnabled)
  );

  return (
    <Box p="md">
      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, sm: 4, md: 3 }}>
          <Stack gap="xs">
            {visibleSections.map((section) => (
              <Link
                key={section.id}
                to={`/config?${TAB_KEY}=${section.id}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <Card
                  withBorder
                  padding="sm"
                  radius="md"
                  style={{
                    cursor: 'pointer',
                    backgroundColor: activeTab === section.id ? 'var(--mantine-color-default-hover)' : undefined,
                  }}
                >
                  <Text fw={activeTab === section.id ? 600 : 500} size="sm">
                    {section.label}
                  </Text>
                  {section.description && (
                    <Text size="xs" c="dimmed" mt={2} lineClamp={2}>
                      {section.description}
                    </Text>
                  )}
                </Card>
              </Link>
            ))}
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 8, md: 9 }}>
          <Box pt={{ base: 0, sm: 0 }}>
            {activeTab === 'general' && <GeneralSettingsSection />}
            {activeTab === 'runpod' && runpodManagementEnabled && <RunPodPage />}
            {activeTab === 'runpod' && !runpodManagementEnabled && <GeneralSettingsSection />}
            {activeTab === 'vms' && vmManagementEnabled && <VMsPage />}
            {activeTab === 'vms' && !vmManagementEnabled && <GeneralSettingsSection />}
            {activeTab === 'projects' && <ProjectsPage />}
            {activeTab === 'providers' && <LLMProvidersPage />}
            {activeTab === 'assistants' && <AssistantInstructionsPage />}
            {activeTab === 'github' && <GitHubConfigPage />}
            {activeTab === 'code' && <CodeConfigSection />}
            {activeTab === 'plugins' && <PluginsSection />}
            {activeTab === 'tools' && <ToolsSection />}
          </Box>
        </Grid.Col>
      </Grid>
    </Box>
  );
}
