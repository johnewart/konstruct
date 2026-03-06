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
import { Stack, Text, Textarea, Button, Card, Group, Alert, SimpleGrid } from '@mantine/core';
import { trpc } from '../../client/trpc';

export function AssistantInstructionsPage() {
  const utils = trpc.useUtils();
  const { data: modes, isLoading: modesLoading } = trpc.chat.listModes.useQuery();
  const { data: instructionsMap, isLoading: instructionsLoading } =
    trpc.chat.getModeInstructions.useQuery();
  const setInstructions = trpc.chat.setModeInstructions.useMutation({
    onSuccess: () => void utils.chat.getModeInstructions.invalidate(),
  });

  const [dirty, setDirty] = useState<Record<string, string>>({});

  const handleChange = (modeId: string, value: string) => {
    setDirty((prev) => ({ ...prev, [modeId]: value }));
  };

  const handleSave = (modeId: string) => {
    const value = dirty[modeId] ?? instructionsMap?.[modeId] ?? '';
    setInstructions.mutate({ modeId, instructions: value }, {
      onSuccess: () => setDirty((prev) => ({ ...prev, [modeId]: undefined })),
    });
  };

  const currentValue = (modeId: string) =>
    dirty[modeId] !== undefined ? dirty[modeId] : (instructionsMap?.[modeId] ?? '');

  if (modesLoading || !modes?.length) {
    return (
      <Stack gap="md" maw={720}>
        <Text size="sm" c="dimmed">
          {modesLoading ? 'Loading assistants…' : 'No assistants available.'}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="lg">
      <Text size="sm" c="dimmed">
        Add extended instructions per assistant. These are appended to the system prompt so you can
        add personal preferences, project-specific rules, or things you want the assistant to always
        consider. The code reviewer (and every other mode) will always include these rules when
        they are set.
      </Text>
      {instructionsLoading && (
        <Text size="sm" c="dimmed">
          Loading saved instructions…
        </Text>
      )}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg" verticalSpacing="lg">
        {modes.map((mode) => (
          <Card
            key={mode.id}
            withBorder
            padding="md"
            radius="md"
            style={{ minHeight: 420 }}
          >
            <Stack gap="xs" style={{ height: '100%' }}>
              <Group justify="space-between" align="flex-start">
                <div>
                  <Text fw={600} size="sm">
                    {mode.name}
                  </Text>
                  {mode.description && (
                    <Text size="xs" c="dimmed" mt={4}>
                      {mode.description}
                    </Text>
                  )}
                </div>
              </Group>
              <Textarea
                label="Extended instructions"
                placeholder="e.g. Prefer functional style. Never suggest eval(). Always mention security implications."
                minRows={14}
                value={currentValue(mode.id)}
                onChange={(e) => handleChange(mode.id, e.currentTarget.value)}
                description="Appended to this assistant's system prompt."
                styles={{
                  input: {
                    fontFamily: 'var(--mono-font)',
                    fontSize: '0.85em',
                    minHeight: 280,
                  },
                }}
              />
              <Group>
                <Button
                  size="xs"
                  variant="light"
                  onClick={() => handleSave(mode.id)}
                  loading={setInstructions.isPending}
                  disabled={dirty[mode.id] === undefined}
                >
                  Save
                </Button>
                {dirty[mode.id] !== undefined && (
                  <Text size="xs" c="dimmed">
                    Unsaved changes
                  </Text>
                )}
              </Group>
              {setInstructions.isError && setInstructions.variables?.modeId === mode.id && (
                <Alert color="red">{setInstructions.error.message}</Alert>
              )}
              {setInstructions.isSuccess && setInstructions.variables?.modeId === mode.id && (
                <Alert color="green">Saved.</Alert>
              )}
            </Stack>
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
