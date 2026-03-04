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

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Box,
  Loader,
  Text,
  Title,
  Alert,
  Stack,
  Group,
  Anchor,
  TextInput,
} from '@mantine/core';
import { IconExternalLink } from '@tabler/icons-react';
import { trpc } from '../../client/trpc';
import { DiffViewer } from '../components/DiffViewer';
import { ReviewAssistantPanel } from '../components/ReviewAssistantPanel';
import type { GitDiffFile } from '../../shared/types';

const CARD_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--app-surface)',
  border: '1px solid var(--app-border)',
  borderRadius: 8,
  boxShadow: '0 2px 8px var(--app-shadow)',
  overflow: 'hidden',
};

type PRItem = {
  number: number;
  title: string;
  state: string;
  htmlUrl: string;
  user: string;
  headRef: string;
  baseRef: string;
};

export function PullRequestsPage() {
  const [selectedPr, setSelectedPr] = useState<PRItem | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [reviewChatSessionId, setReviewChatSessionId] = useState<string | null>(null);
  const [prFilter, setPrFilter] = useState('');

  const { data: githubRepo, isLoading: repoLoading } = trpc.github.getRepo.useQuery();
  const { data: prData, isLoading: prLoading } = trpc.github.listPullRequests.useQuery(
    undefined,
    { enabled: !!githubRepo }
  );
  const { data: prDiffData, isLoading: diffLoading } = trpc.github.getPullRequestDiff.useQuery(
    { pullNumber: selectedPr?.number ?? 0 },
    { enabled: !!selectedPr?.number }
  );
  const createReviewChatSession = trpc.sessions.create.useMutation({
    onSuccess: (session) => setReviewChatSessionId(session.id),
  });

  useEffect(() => {
    if (githubRepo && !reviewChatSessionId) {
      createReviewChatSession.mutate({ title: 'PR review' });
    }
  }, [githubRepo, reviewChatSessionId]);

  const diffFiles: GitDiffFile[] = prDiffData?.error === null ? prDiffData.diffFiles : [];
  const hasDiff = diffFiles.length > 0;

  if (repoLoading) {
    return (
      <Box style={{ textAlign: 'center', padding: '40px' }}>
        <Loader size="lg" />
        <Text mt="sm">Loading…</Text>
      </Box>
    );
  }

  if (!githubRepo) {
    return (
      <Box style={{ padding: '20px', maxWidth: 560 }}>
        <Title order={3} mb="sm">Pull requests</Title>
        <Alert color="blue" title="Not a GitHub repository">
          <Text size="sm">
            The current project&apos;s git remote is not on GitHub, or there is no origin. Add a
            GitHub remote to view pull requests here.
          </Text>
        </Alert>
      </Box>
    );
  }

  if (prLoading) {
    return (
      <Box style={{ textAlign: 'center', padding: '40px' }}>
        <Loader size="lg" />
        <Text mt="sm">Loading pull requests…</Text>
      </Box>
    );
  }

  const tokenRequired = prData?.error === 'token_required';
  const apiError = prData?.error === 'api_error';
  const allPrs = prData?.error === null ? prData.pullRequests : [];
  const prFilterLower = prFilter.trim().toLowerCase();
  const prList = prFilterLower
    ? allPrs.filter(
        (pr) =>
          `${pr.number} ${pr.title} ${pr.user} ${pr.headRef} ${pr.baseRef}`.toLowerCase().includes(prFilterLower)
      )
    : allPrs;

  if (tokenRequired) {
    return (
      <Box style={{ padding: '20px', maxWidth: 560 }}>
        <Title order={3} mb="md">Pull requests · {githubRepo.owner}/{githubRepo.repo}</Title>
        <Alert color="blue" title="GitHub token required">
          <Text size="sm">
            Configure a GitHub token in{' '}
            <Link to="/config?tab=github">Configuration → GitHub</Link> to view pull
            requests for this repository.
          </Text>
        </Alert>
      </Box>
    );
  }

  if (apiError) {
    return (
      <Box style={{ padding: '20px', maxWidth: 560 }}>
        <Title order={3} mb="md">Pull requests</Title>
        <Alert color="red" title="GitHub API error">
          {prData?.message ?? 'Failed to load pull requests.'}
        </Alert>
      </Box>
    );
  }

  return (
    <Box
      style={{
        padding: '20px',
        display: 'flex',
        flexDirection: 'row',
        height: 'calc(100vh - 60px)',
        minHeight: 0,
        gap: 16,
      }}
    >
      {/* Left: PR list */}
      <Box
        style={{
          ...CARD_STYLE,
          width: 320,
          minWidth: 280,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <Box style={{ padding: '12px 16px', borderBottom: '1px solid var(--app-border)' }}>
          <Title order={4}>Pull requests</Title>
          <Text size="xs" c="dimmed">{githubRepo.owner}/{githubRepo.repo}</Text>
        </Box>
        <Box style={{ padding: 8, borderBottom: '1px solid var(--app-border)' }}>
          <TextInput
            placeholder="Filter by title, number, user…"
            value={prFilter}
            onChange={(e) => setPrFilter(e.currentTarget.value)}
            size="xs"
            styles={{ input: { fontSize: '0.875rem' } }}
          />
        </Box>
        <Stack gap={0} style={{ flex: 1, overflow: 'auto', padding: 8 }}>
          {prList.length === 0 ? (
            <Text size="sm" c="dimmed" p="sm">
              {prFilterLower ? 'No pull requests match the filter.' : 'No open pull requests.'}
            </Text>
          ) : (
            prList.map((pr) => (
              <Box
                key={pr.number}
                style={{
                  padding: 12,
                  borderRadius: 6,
                  cursor: 'pointer',
                  backgroundColor: selectedPr?.number === pr.number ? 'var(--app-accent-bg)' : 'transparent',
                  border: selectedPr?.number === pr.number ? '1px solid var(--app-accent)' : '1px solid transparent',
                }}
                onClick={() => { setSelectedPr(pr); setActiveFile(null); }}
              >
                <Group justify="space-between" wrap="nowrap" gap="sm">
                  <Box style={{ minWidth: 0 }}>
                    <Text fw={600} size="sm">
                      #{pr.number} {pr.title}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {pr.user} · {pr.headRef} → {pr.baseRef}
                    </Text>
                  </Box>
                  <Anchor
                    href={pr.htmlUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="sm"
                    style={{ flexShrink: 0 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <IconExternalLink size={14} />
                  </Anchor>
                </Group>
              </Box>
            ))
          )}
        </Stack>
      </Box>

      {/* Right: diff + chat (when a PR is selected) */}
      <Box style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!selectedPr ? (
          <Box
            style={{
              ...CARD_STYLE,
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text c="dimmed">Select a pull request to view its diff.</Text>
          </Box>
        ) : (
          <>
            {/* Top: PR diff */}
            <Box
              style={{
                ...CARD_STYLE,
                flex: 3,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <Box style={{ padding: '12px 16px', borderBottom: '1px solid var(--app-border)', flexShrink: 0 }}>
                <Title order={4}>#{selectedPr.number} {selectedPr.title}</Title>
                <Text size="xs" c="dimmed">{selectedPr.headRef} → {selectedPr.baseRef}</Text>
              </Box>
              {diffLoading ? (
                <Box py="xl" style={{ textAlign: 'center' }}>
                  <Loader size="sm" />
                  <Text size="sm" c="dimmed" mt="xs">Loading diff…</Text>
                </Box>
              ) : prDiffData?.error ? (
                <Box p="md">
                  <Alert color="red" title="Could not load diff">
                    {prDiffData.message ?? prDiffData.error}
                  </Alert>
                </Box>
              ) : hasDiff ? (
                <Box style={{ flex: 1, minHeight: 0 }}>
                  <DiffViewer
                    diffFiles={diffFiles}
                    activeFile={activeFile}
                    onFileSelect={setActiveFile}
                    sessionId={null}
                    comments={[]}
                    onCommentAdded={() => {}}
                  />
                </Box>
              ) : (
                <Box py="xl" style={{ textAlign: 'center' }}>
                  <Text size="sm" c="dimmed">No diff for this PR.</Text>
                </Box>
              )}
            </Box>

            {/* Bottom: chat + reviewer image on the right */}
            <Box
              style={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'row',
                gap: 16,
                alignItems: 'stretch',
              }}
            >
              <Box
                style={{
                  ...CARD_STYLE,
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <ReviewAssistantPanel
                  sessionId={reviewChatSessionId}
                  prContext={selectedPr ? { pullNumber: selectedPr.number } : undefined}
                />
              </Box>
              <Box
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 12,
                }}
              >
                <img
                  src="/static/konstruct-reviewer.png"
                  alt="Code reviewer"
                  style={{ maxWidth: 160, height: 'auto', maxHeight: 180, objectFit: 'contain' }}
                />
              </Box>
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}

export default PullRequestsPage;
