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
import { Stack, Text, PasswordInput, Button, Alert } from '@mantine/core';
import { trpc } from '../../client/trpc';

export function GitHubConfigPage() {
  const [token, setToken] = useState('');
  const utils = trpc.useUtils();
  const { data: tokenStatus } = trpc.github.getTokenStatus.useQuery();
  const setTokenMutation = trpc.github.setToken.useMutation({
    onSuccess: () => {
      setToken('');
      void utils.github.getTokenStatus.invalidate();
    },
  });

  return (
    <Stack gap="md" maw={480}>
      <Text size="sm" c="dimmed">
        A GitHub personal access token is stored centrally and used to list pull requests for
        repositories with a GitHub origin. Create a token with <code>repo</code> scope (or
        minimal <code>public_repo</code> for public repos only) at{' '}
        <a
          href="https://github.com/settings/tokens"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--app-accent)' }}
        >
          GitHub Settings → Developer settings → Personal access tokens
        </a>
        .
      </Text>
      {tokenStatus?.configured && (
        <Alert color="green" title="Token configured">
          A GitHub token is saved. Enter a new token below to replace it.
        </Alert>
      )}
      <PasswordInput
        label="GitHub token"
        placeholder={tokenStatus?.configured ? 'Enter new token to replace' : 'ghp_…'}
        value={token}
        onChange={(e) => setToken(e.currentTarget.value)}
        description="Stored in ~/.config/konstruct/config.yml"
      />
      <Button
        onClick={() => setTokenMutation.mutate({ token })}
        loading={setTokenMutation.isPending}
        disabled={!token.trim()}
      >
        Save token
      </Button>
      {setTokenMutation.isError && (
        <Alert color="red">{setTokenMutation.error.message}</Alert>
      )}
      {setTokenMutation.isSuccess && (
        <Alert color="green">Token saved.</Alert>
      )}
    </Stack>
  );
}
