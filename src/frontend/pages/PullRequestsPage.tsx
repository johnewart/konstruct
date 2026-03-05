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

import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Accordion,
  Badge,
  Box,
  Button,
  Loader,
  List,
  Text,
  Title,
  Tabs,
  Alert,
  Stack,
  Group,
  Anchor,
  TextInput,
  ActionIcon,
} from '@mantine/core';
import { IconExternalLink, IconMessageCircle, IconChevronDown } from '@tabler/icons-react';
import { trpc } from '../../client/trpc';
import { useProjectModel } from '../contexts/ProjectModelContext';
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

type Level = 'high' | 'medium' | 'low';

const LEVEL_COLORS: Record<Level, string> = {
  high: 'red',
  medium: 'yellow',
  low: 'blue',
};

const LEVEL_BADGE_STYLE: React.CSSProperties = { minWidth: 64, textAlign: 'center' as const };

function normalizeLevel(s: string | undefined): Level {
  if (s == null || typeof s !== 'string') return 'medium';
  const v = s.toLowerCase().trim();
  if (v === 'high') return 'high';
  if (v === 'low') return 'low';
  return 'medium';
}

function LevelBadge({ level }: { level?: Level }) {
  const L = level === 'high' || level === 'medium' || level === 'low' ? level : 'medium';
  return (
    <Badge
      size="sm"
      variant="light"
      color={LEVEL_COLORS[L]}
      style={LEVEL_BADGE_STYLE}
      component="span"
    >
      {L.charAt(0).toUpperCase() + L.slice(1)}
    </Badge>
  );
}

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
  const { providerId: projectProviderId, modelId: projectModelId } = useProjectModel();
  const [selectedPr, setSelectedPr] = useState<PRItem | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [reviewChatSessionId, setReviewChatSessionId] = useState<string | null>(null);
  const [reviewChatOpen, setReviewChatOpen] = useState(false);
  const [reviewChatPosition, setReviewChatPosition] = useState<{ x: number; y: number } | null>(null);
  const reviewChatBoxRef = useRef<HTMLDivElement>(null);
  const reviewChatDragStartRef = useRef<{ clientX: number; clientY: number; windowX: number; windowY: number } | null>(null);
  const reviewChatDragHandlersRef = useRef<{ onMove: (e: MouseEvent) => void; onUp: () => void } | null>(null);
  const [prFilter, setPrFilter] = useState('');

  const handleReviewChatTitleMouseDown = (e: React.MouseEvent) => {
    if (e.target instanceof HTMLElement && e.target.closest('button')) return;
    if (!reviewChatBoxRef.current) return;
    const rect = reviewChatBoxRef.current.getBoundingClientRect();
    const windowX = reviewChatPosition?.x ?? rect.left;
    const windowY = reviewChatPosition?.y ?? rect.top;
    if (reviewChatPosition === null) setReviewChatPosition({ x: rect.left, y: rect.top });
    reviewChatDragStartRef.current = { clientX: e.clientX, clientY: e.clientY, windowX, windowY };
    const onMove = (e: MouseEvent) => {
      if (!reviewChatDragStartRef.current) return;
      setReviewChatPosition({
        x: reviewChatDragStartRef.current.windowX + (e.clientX - reviewChatDragStartRef.current.clientX),
        y: reviewChatDragStartRef.current.windowY + (e.clientY - reviewChatDragStartRef.current.clientY),
      });
    };
    const onUp = () => {
      reviewChatDragStartRef.current = null;
      const h = reviewChatDragHandlersRef.current;
      if (h) {
        document.removeEventListener('mousemove', h.onMove);
        document.removeEventListener('mouseup', h.onUp);
        reviewChatDragHandlersRef.current = null;
      }
    };
    reviewChatDragHandlersRef.current = { onMove, onUp };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

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
      createReviewChatSession.mutate({ title: 'PR review', ephemeral: true });
    }
  }, [githubRepo, reviewChatSessionId]);

  const diffFiles: GitDiffFile[] = prDiffData?.error === null ? prDiffData.diffFiles : [];
  const hasDiff = diffFiles.length > 0;

  const depGraphRefetchAt100 = useRef(false);
  const { data: depGraph, isLoading: depGraphLoading, refetch: refetchDepGraph } = trpc.codebase.getDependencyGraph.useQuery(
    { path: '.' },
    {
      enabled: !!selectedPr && diffFiles.length > 0,
      refetchInterval: (q) => {
        const d = q.state.data;
        if (!d?.building) return false;
        const total = d.totalFiles ?? 0;
        const done = d.filesProcessed ?? 0;
        if (total > 0 && done >= total) return 200;
        return 800;
      },
    }
  );
  useEffect(() => {
    if (!depGraph?.building || !depGraph?.totalFiles || depGraph.totalFiles === 0) {
      depGraphRefetchAt100.current = false;
      return;
    }
    if (depGraph.filesProcessed >= depGraph.totalFiles) {
      if (depGraphRefetchAt100.current) return;
      depGraphRefetchAt100.current = true;
      const t1 = setTimeout(() => refetchDepGraph(), 100);
      const t2 = setTimeout(() => refetchDepGraph(), 350);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
    depGraphRefetchAt100.current = false;
  }, [depGraph?.building, depGraph?.filesProcessed, depGraph?.totalFiles, refetchDepGraph]);
  const { data: reviewSession } = trpc.sessions.get.useQuery(
    { id: reviewChatSessionId! },
    { enabled: !!reviewChatSessionId && !!selectedPr }
  );
  const utils = trpc.useUtils();
  const { data: overviewData, refetch: refetchOverview } = trpc.github.getPROverview.useQuery(
    {
      pullNumber: selectedPr?.number ?? 0,
      providerId: projectProviderId ?? undefined,
      model: projectModelId ?? undefined,
    },
    {
      enabled: !!selectedPr?.number,
      refetchInterval: (q) => (q.state.data?.building ? 1200 : false),
    }
  );
  const invalidateOverview = trpc.github.invalidatePROverview.useMutation({
    onSuccess: (_, variables) => {
      utils.github.getPROverview.invalidate({ pullNumber: variables.pullNumber });
      refetchOverview();
    },
  });

  const prFileSet = new Set(
    diffFiles.map((f) => f.path.replace(/\\/g, '/').trim())
  );
  let inboundFiles: string[] = [];
  let outboundFiles: string[] = [];
  if (depGraph?.nodes?.length && depGraph?.edges?.length && !depGraph.building && activeFile) {
    const active = activeFile.replace(/\\/g, '/').trim();
    const inbound = new Set<string>();
    const outbound = new Set<string>();
    for (const e of depGraph.edges) {
      const s = (e.source ?? '').replace(/\\/g, '/').trim();
      const t = (e.target ?? '').replace(/\\/g, '/').trim();
      if (t === active && s) inbound.add(s);
      if (s === active && t) outbound.add(t);
    }
    inboundFiles = [...inbound].sort();
    outboundFiles = [...outbound].sort();
  }
  const suggestedFiles = reviewSession?.suggestedFiles ?? [];
  const suggestedImprovements = reviewSession?.suggestedImprovements ?? [];

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
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'row',
        height: '100%',
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
        <Box style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--app-border)' }}>
          <img
            src="/static/konstruct-waving.png"
            alt="Konstruct"
            style={{ maxWidth: 80, height: 'auto', maxHeight: 90, objectFit: 'contain', flexShrink: 0 }}
          />
          <span
            style={{
              fontSize: '2rem',
              fontWeight: 700,
              letterSpacing: '-1px',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text' as const,
            }}
          >
            Konstruct
          </span>
        </Box>
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

      {/* Center: diff + chat (when a PR is selected) */}
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
            {/* PR tabs (Overview | Diff) */}
            <Box
              style={{
                ...CARD_STYLE,
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <Box style={{ padding: '12px 16px', borderBottom: '1px solid var(--app-border)', flexShrink: 0 }}>
                <Title order={4}>#{selectedPr.number} {selectedPr.title}</Title>
                <Text size="xs" c="dimmed">{selectedPr.headRef} → {selectedPr.baseRef}</Text>
              </Box>
              <Tabs defaultValue="overview" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <Tabs.List>
                  <Tabs.Tab value="overview">Overview</Tabs.Tab>
                  <Tabs.Tab value="diff">Diff</Tabs.Tab>
                </Tabs.List>
                <Tabs.Panel value="overview" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                  {selectedPr && (
                    <Box style={{ padding: '8px 16px', borderBottom: '1px solid var(--app-border)', flexShrink: 0 }}>
                      <Button
                        variant="light"
                        size="xs"
                        loading={invalidateOverview.isPending || overviewData?.building}
                        disabled={overviewData?.building}
                        onClick={() => selectedPr && invalidateOverview.mutate({ pullNumber: selectedPr.number })}
                      >
                        {overviewData?.building ? 'Analyzing…' : 'Regenerate summary'}
                      </Button>
                    </Box>
                  )}
                  {overviewData?.building ? (
                    <Box py="xl" style={{ textAlign: 'center' }}>
                      <Loader size="sm" />
                      <Text size="md" c="dimmed" mt="xs">Analyzing PR…</Text>
                    </Box>
                  ) : overviewData?.error ? (
                    <Box p="md">
                      <Alert color="orange" title="Overview unavailable">{overviewData.error}</Alert>
                    </Box>
                  ) : overviewData?.overview ? (
                    <Box p="md" style={{ fontSize: '1.0625rem' }}>
                      <Title order={4} mb="sm">{overviewData.overview.title}</Title>
                      <Text size="md" mb="md" c="dimmed">{overviewData.overview.summary}</Text>
                      {overviewData.overview.keyFiles.length > 0 && (
                        <Stack gap="xs" mb="md">
                          <Text size="lg" fw={600}>Key files</Text>
                          <List size="lg" spacing="xs">
                            {overviewData.overview.keyFiles.map((k) => (
                              <List.Item key={k.path}>
                                <LevelBadge level={normalizeLevel(k.dangerLevel)} />
                                <Text component="span" size="lg" ml="xs">{k.path}</Text>
                                {k.reason && <Text size="md" c="dimmed" ml="xs">{k.reason}</Text>}
                              </List.Item>
                            ))}
                          </List>
                        </Stack>
                      )}
                      {overviewData.overview.actionItems.length > 0 && (
                        <Stack gap="xs">
                          <Text size="md" fw={600}>Things to look for</Text>
                          <List size="md" spacing="xs">
                            {overviewData.overview.actionItems.map((item, i) => (
                              <List.Item key={i}>
                                <LevelBadge level={item.level} />
                                <Text component="span" size="md" ml="xs">{item.text}</Text>
                                {item.files && item.files.length > 0 && (
                                  <Text size="xs" c="dimmed" ml="xs" component="span">
                                    ({item.files.join(', ')})
                                  </Text>
                                )}
                              </List.Item>
                            ))}
                          </List>
                        </Stack>
                      )}
                    </Box>
                  ) : null}
                </Tabs.Panel>
                <Tabs.Panel value="diff" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
                </Tabs.Panel>
              </Tabs>
            </Box>

            {/* Floating chat button */}
            <ActionIcon
              size={56}
              radius="xl"
              variant="filled"
              color="blue"
              aria-label={reviewChatOpen ? 'Close chat' : 'Chat about this review'}
              style={{
                position: 'fixed',
                bottom: 24,
                right: 24,
                zIndex: 1001,
                boxShadow: '0 4px 12px var(--app-shadow)',
              }}
              onClick={() => setReviewChatOpen((open) => !open)}
            >
              <IconMessageCircle size={28} />
            </ActionIcon>

            {/* Floating chat window at bottom */}
            {reviewChatOpen && (
              <Box
                ref={reviewChatBoxRef}
                style={{
                  position: 'fixed',
                  ...(reviewChatPosition === null
                    ? { bottom: 24, left: '50%', transform: 'translateX(-50%)' }
                    : { left: reviewChatPosition.x, top: reviewChatPosition.y }),
                  width: '66.67%',
                  maxWidth: 900,
                  height: '35vh',
                  minHeight: 280,
                  maxHeight: 480,
                  zIndex: 1000,
                  ...CARD_STYLE,
                  borderRadius: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                <Group
                  justify="space-between"
                  wrap="nowrap"
                  style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--app-border)',
                    flexShrink: 0,
                    cursor: 'move',
                  }}
                  onMouseDown={handleReviewChatTitleMouseDown}
                >
                  <Text size="sm" fw={600}>Chat about this review</Text>
                  <ActionIcon variant="subtle" size="sm" aria-label="Minimize" onClick={() => setReviewChatOpen(false)}>
                    <IconChevronDown size={18} />
                  </ActionIcon>
                </Group>
                <Box style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <ReviewAssistantPanel
                    sessionId={reviewChatSessionId}
                    prContext={selectedPr ? { pullNumber: selectedPr.number } : undefined}
                  />
                </Box>
              </Box>
            )}
          </>
        )}
      </Box>

      {/* Right: accordion (Inbound / Outbound / Assistant suggestions) when a PR is selected */}
      {selectedPr && (
        <Box className="chat-right-panel" style={{ ...CARD_STYLE, borderLeft: '1px solid var(--app-border)' }}>
          <Box style={{ padding: '8px 14px', borderBottom: '1px solid var(--app-border)', flexShrink: 0 }}>
            <Title order={5} style={{ margin: 0, fontSize: '0.85em', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
              Context
            </Title>
          </Box>
          <Accordion defaultValue={['inbound', 'outbound', 'suggestions', 'improvements']} multiple style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Accordion.Item value="inbound">
              <Accordion.Control>
                <Text component="span" size="sm" fw={600}>Depend on this file (inbound)</Text>
              </Accordion.Control>
              <Accordion.Panel>
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 12px' }}>
                  <Text size="xs" c="dimmed" mb="xs">
                    Files that import or depend on the selected file.
                  </Text>
                  {!activeFile ? (
                    <Text size="sm" c="dimmed">Select a file in the diff to see inbound dependencies.</Text>
                  ) : depGraphLoading && !depGraph ? (
                    <Group gap="xs">
                      <Loader size="sm" />
                      <Text size="sm" c="dimmed">Loading graph…</Text>
                    </Group>
                  ) : depGraph?.building ? (
                    <Stack gap={4}>
                      <Group gap="xs">
                        <Loader size="sm" />
                        <Text size="sm" c="dimmed">
                          {depGraph.phase === 'discovering'
                            ? `Discovering… ${depGraph.filesProcessed ?? 0} found`
                            : `Building… ${depGraph.filesProcessed ?? 0}/${depGraph.totalFiles ?? 0}`}
                        </Text>
                      </Group>
                      {depGraph.currentDir && <Text size="xs" c="dimmed">In: {depGraph.currentDir}</Text>}
                    </Stack>
                  ) : depGraph?.error ? (
                    <Text size="sm" c="red">{depGraph.error}</Text>
                  ) : inboundFiles.length === 0 ? (
                    <Text size="sm" c="dimmed">No inbound dependencies in the graph.</Text>
                  ) : (
                    <Stack gap={4}>
                      {inboundFiles.map((p) => (
                        <Text key={p} size="sm" component="div" style={{ fontFamily: 'var(--mono-font)', wordBreak: 'break-all' }}>{p}</Text>
                      ))}
                    </Stack>
                  )}
                </div>
              </Accordion.Panel>
            </Accordion.Item>
            <Accordion.Item value="outbound">
              <Accordion.Control>
                <Text component="span" size="sm" fw={600}>This file depends on (outbound)</Text>
              </Accordion.Control>
              <Accordion.Panel>
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 12px' }}>
                  <Text size="xs" c="dimmed" mb="xs">
                    Files the selected file imports or depends on.
                  </Text>
                  {!activeFile ? (
                    <Text size="sm" c="dimmed">Select a file in the diff to see outbound dependencies.</Text>
                  ) : depGraphLoading && !depGraph ? (
                    <Group gap="xs">
                      <Loader size="sm" />
                      <Text size="sm" c="dimmed">Loading graph…</Text>
                    </Group>
                  ) : depGraph?.building ? (
                    <Stack gap={4}>
                      <Group gap="xs">
                        <Loader size="sm" />
                        <Text size="sm" c="dimmed">
                          {depGraph.phase === 'discovering'
                            ? `Discovering… ${depGraph.filesProcessed ?? 0} found`
                            : `Building… ${depGraph.filesProcessed ?? 0}/${depGraph.totalFiles ?? 0}`}
                        </Text>
                      </Group>
                      {depGraph.currentDir && <Text size="xs" c="dimmed">In: {depGraph.currentDir}</Text>}
                    </Stack>
                  ) : depGraph?.error ? (
                    <Text size="sm" c="red">{depGraph.error}</Text>
                  ) : outboundFiles.length === 0 ? (
                    <Text size="sm" c="dimmed">No outbound dependencies in the graph.</Text>
                  ) : (
                    <Stack gap={4}>
                      {outboundFiles.map((p) => (
                        <Text key={p} size="sm" component="div" style={{ fontFamily: 'var(--mono-font)', wordBreak: 'break-all' }}>{p}</Text>
                      ))}
                    </Stack>
                  )}
                </div>
              </Accordion.Panel>
            </Accordion.Item>
            <Accordion.Item value="suggestions">
              <Accordion.Control>
                <Text component="span" size="sm" fw={600}>Assistant suggestions</Text>
              </Accordion.Control>
              <Accordion.Panel>
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 12px' }}>
                  <Text size="xs" c="dimmed" mb="xs">
                    Files the reviewer assistant thinks are relevant (even if not in the graph).
                  </Text>
                  {suggestedFiles.length === 0 ? (
                    <Text size="sm" c="dimmed">None yet. Ask the assistant to review; it can suggest files.</Text>
                  ) : (
                    <Stack gap={4}>
                      {suggestedFiles.map((p) => (
                        <Text key={p} size="sm" component="div" style={{ fontFamily: 'var(--mono-font)', wordBreak: 'break-all' }}>{p}</Text>
                      ))}
                    </Stack>
                  )}
                </div>
              </Accordion.Panel>
            </Accordion.Item>
            <Accordion.Item value="improvements">
              <Accordion.Control>
                <Text component="span" size="sm" fw={600}>Suggested improvements</Text>
              </Accordion.Control>
              <Accordion.Panel>
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 12px' }}>
                  <Text size="xs" c="dimmed" mb="xs">
                    Code improvements the reviewer suggested (file, line, and optional snippet).
                  </Text>
                  {suggestedImprovements.length === 0 ? (
                    <Text size="sm" c="dimmed">None yet. Ask the assistant to review; it can suggest improvements via the suggest_improvement tool.</Text>
                  ) : (
                    <Stack gap="sm">
                      {suggestedImprovements.map((imp, i) => (
                        <Box key={i} p="xs" style={{ border: '1px solid var(--app-border)', borderRadius: 6, backgroundColor: 'var(--app-bg)' }}>
                          <Text size="sm" component="div" style={{ fontFamily: 'var(--mono-font)', wordBreak: 'break-all' }}>
                            {imp.filePath}{imp.lineNumber != null ? `:${imp.lineNumber}` : ''}
                          </Text>
                          <Text size="sm" mt={4}>{imp.suggestion}</Text>
                          {imp.snippet ? (
                            <Box component="pre" mt="xs" p="xs" style={{ fontSize: '0.75rem', overflow: 'auto', backgroundColor: 'var(--app-surface)', borderRadius: 4 }}>{imp.snippet}</Box>
                          ) : null}
                        </Box>
                      ))}
                    </Stack>
                  )}
                </div>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </Box>
      )}
    </Box>
  );
}

export default PullRequestsPage;
