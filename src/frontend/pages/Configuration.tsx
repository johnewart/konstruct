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
import { Tabs, Stack, Group, Text } from '@mantine/core';
import { RunPodPage } from './RunPod';
import { VMsPage } from './VMs';
import { ProjectsPage } from './Projects';
import { LLMProvidersPage } from './LLMProviders';
import { GitHubConfigPage } from './GitHubConfig';
import { AssistantInstructionsPage } from './AssistantInstructionsPage';

const TAB_KEY = 'tab';
const TABS = ['runpod', 'vms', 'projects', 'providers', 'assistants', 'github'] as const;
type TabValue = (typeof TABS)[number];

function isValidTab(v: string): v is TabValue {
  return TABS.includes(v as TabValue);
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
      </Tabs>
    </Stack>
  );
}
