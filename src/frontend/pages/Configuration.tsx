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

import { Link, useSearchParams } from 'react-router-dom';
import { Stack, Text, Card, Button, Grid, Box, Switch, Group } from '@mantine/core';
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
] as const;
type TabValue = (typeof SECTIONS)[number]['id'];

function isValidTab(v: string): v is TabValue {
  return SECTIONS.some((s) => s.id === v);
}

function GeneralSettingsSection() {
  const { data, isLoading } = trpc.providerConfig.getRunpodManagementEnabled.useQuery();
  const setRunpodEnabled = trpc.providerConfig.setRunpodManagementEnabled.useMutation();
  const utils = trpc.useUtils();
  const enabled = data?.enabled ?? true;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.currentTarget.checked;
    setRunpodEnabled.mutate(
      { enabled: next },
      {
        onSuccess: () => {
          void utils.providerConfig.getRunpodManagementEnabled.invalidate();
        },
      }
    );
  };

  return (
    <Stack gap="md">
      <Text fw={600} size="sm">
        Settings
      </Text>
      <Text size="sm" c="dimmed">
        Use the menu on the left to switch between sections: RunPod, projects, LLM providers, assistants, GitHub, and code graph options.
      </Text>
      <Group justify="space-between">
        <Text size="sm" fw={500}>
          Enable RunPod management
        </Text>
        {/* Uncontrolled so the native input handles the toggle; we persist on change */}
        <Switch
          key={`runpod-enabled-${enabled}`}
          size="md"
          defaultChecked={enabled}
          disabled={isLoading}
          onChange={handleChange}
          aria-label="Enable RunPod management"
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
  const runpodManagementEnabled = runpodEnabledData?.enabled !== false;
  const visibleSections = runpodManagementEnabled
    ? SECTIONS
    : SECTIONS.filter((s) => s.id !== 'runpod');

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
            {activeTab === 'vms' && <VMsPage />}
            {activeTab === 'projects' && <ProjectsPage />}
            {activeTab === 'providers' && <LLMProvidersPage />}
            {activeTab === 'assistants' && <AssistantInstructionsPage />}
            {activeTab === 'github' && <GitHubConfigPage />}
            {activeTab === 'code' && <CodeConfigSection />}
          </Box>
        </Grid.Col>
      </Grid>
    </Box>
  );
}
