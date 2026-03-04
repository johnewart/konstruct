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
import { Tabs, Stack, Group, Text, Card, Button } from '@mantine/core';
import { RunPodPage } from './RunPod';
import { VMsPage } from './VMs';
import { ProjectsPage } from './Projects';
import { LLMProvidersPage } from './LLMProviders';
import { GitHubConfigPage } from './GitHubConfig';
import { AssistantInstructionsPage } from './AssistantInstructionsPage';
import { trpc } from '../../client/trpc';

const TAB_KEY = 'tab';
const TABS = ['runpod', 'vms', 'projects', 'providers', 'assistants', 'github', 'code'] as const;
type TabValue = (typeof TABS)[number];

function isValidTab(v: string): v is TabValue {
  return TABS.includes(v as TabValue);
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
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get(TAB_KEY);
  const activeTab = isValidTab(tab ?? '') ? tab : 'runpod';

  const handleTabChange = (value: string | null) => {
    if (value && isValidTab(value)) {
      setSearchParams({ [TAB_KEY]: value });
    }
  };

  return (
    <Stack p="md" gap="md">
      <Group justify="space-between" align="center">
        <Text size="sm">
          <Link to="/" style={{ color: 'var(--app-text)', textDecoration: 'none' }}>
            ← Back to Chat
          </Link>
        </Text>
      </Group>
      <Tabs value={activeTab} onChange={handleTabChange}>
        <Tabs.List>
          <Tabs.Tab value="runpod">Configure RunPod</Tabs.Tab>
          <Tabs.Tab value="vms">VMs</Tabs.Tab>
          <Tabs.Tab value="projects">Projects</Tabs.Tab>
          <Tabs.Tab value="providers">Providers</Tabs.Tab>
          <Tabs.Tab value="assistants">Assistants</Tabs.Tab>
          <Tabs.Tab value="github">GitHub</Tabs.Tab>
          <Tabs.Tab value="code">Code</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="runpod" pt="md">
          <RunPodPage />
        </Tabs.Panel>
        <Tabs.Panel value="vms" pt="md">
          <VMsPage />
        </Tabs.Panel>
        <Tabs.Panel value="projects" pt="md">
          <ProjectsPage />
        </Tabs.Panel>
        <Tabs.Panel value="providers" pt="md">
          <LLMProvidersPage />
        </Tabs.Panel>
        <Tabs.Panel value="assistants" pt="md">
          <AssistantInstructionsPage />
        </Tabs.Panel>
        <Tabs.Panel value="github" pt="md">
          <GitHubConfigPage />
        </Tabs.Panel>
        <Tabs.Panel value="code" pt="md">
          <CodeConfigSection />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
