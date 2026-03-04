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

import React, { useEffect, useState } from 'react';
import { Badge, Box, Loader, List, Stack, Text, Title, Button, Group, Alert, Tabs, Progress } from '@mantine/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { trpc } from '../../client/trpc';
import { useProjectModel } from '../contexts/ProjectModelContext';
import { DiffViewer } from '../components/DiffViewer';
import { ReviewAssistantPanel } from '../components/ReviewAssistantPanel';

type Level = 'high' | 'medium' | 'low';
const LEVEL_COLORS: Record<Level, string> = { high: 'red', medium: 'yellow', low: 'blue' };
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
    <Badge size="sm" variant="light" color={LEVEL_COLORS[L]} style={LEVEL_BADGE_STYLE} component="span">
      {L.charAt(0).toUpperCase() + L.slice(1)}
    </Badge>
  );
}

const CARD_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--app-surface)',
  border: '1px solid var(--app-border)',
  borderRadius: 8,
  boxShadow: '0 2px 8px var(--app-shadow)',
  overflow: 'hidden',
};

/** Stop displaying thinking content at the start of the expected JSON (e.g. diff overview). */
function thinkingTextBeforeJson(raw: string): { text: string; jsonStarted: boolean } {
  const patterns = [
    /\n\s*\{\s*["']title["']\s*:/,   // newline then { "title" or 'title'
    /\{\s*["']title["']\s*:/,        // { "title" anywhere (no newline)
    /\n\s*"\s*title\s*"\s*:/,        // " title " with spaces
    /\n```(?:json)?\s*\n/,           // newline then ```json or ``` (code fence)
    /```(?:json)?\s*\n/,             // ``` at start of line
  ];
  for (const re of patterns) {
    const idx = raw.search(re);
    if (idx >= 0) {
      return { text: raw.slice(0, idx).trimEnd(), jsonStarted: true };
    }
  }
  return { text: raw, jsonStarted: false };
}

const STREAMING_CHARS_PER_TICK = 2;
const STREAMING_TICK_MS = 28;

export function DiffViewerPage() {
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [reviewChatSessionId, setReviewChatSessionId] = useState<string | null>(null);
  const [frozenThinkingText, setFrozenThinkingText] = useState<string | null>(null);
  const [visibleThinkingLength, setVisibleThinkingLength] = useState(0);
  const { providerId: projectProviderId, modelId: projectModelId } = useProjectModel();

  const { data: diffFiles, isLoading, error } = trpc.git.getGitDiff.useQuery();
  const utils = trpc.useUtils();
  const { data: overviewData, refetch: refetchOverview } = trpc.git.getDiffOverview.useQuery(
    { providerId: projectProviderId ?? undefined, model: projectModelId ?? undefined },
    {
      enabled: !!diffFiles && diffFiles.length > 0,
      refetchInterval: (q) => (q.state.data?.building ? 1200 : false),
    }
  );
  const { data: diffOverviewProgress } = trpc.chat.getRunProgress.useQuery(
    { sessionId: overviewData?.progressId ?? '' },
    {
      enabled: !!overviewData?.building && !!overviewData?.progressId,
      refetchInterval: 600,
    }
  );
  const invalidateOverview = trpc.git.invalidateDiffOverview.useMutation({
    onSuccess: () => {
      utils.git.getDiffOverview.invalidate();
      refetchOverview();
    },
  });
  const createReviewChatSession = trpc.sessions.create.useMutation({
    onSuccess: (session) => setReviewChatSessionId(session.id),
  });
  const { data: reviewChatSession } = trpc.sessions.get.useQuery(
    { id: reviewChatSessionId! },
    { enabled: !!reviewChatSessionId }
  );
  const { data: reviewSession, refetch: refetchReview } = trpc.review.getOrCreateSession.useQuery(
    undefined,
    { enabled: !!diffFiles && diffFiles.length > 0 }
  );
  const startReviewMutation = trpc.review.startReviewSession.useMutation({
    onSuccess: () => {
      utils.review.getOrCreateSession.invalidate();
      refetchReview();
    },
  });

  useEffect(() => {
    if (diffFiles?.length && !reviewChatSessionId)
      createReviewChatSession.mutate({ title: 'Code review', ephemeral: true });
  }, [diffFiles?.length, reviewChatSessionId]);

  useEffect(() => {
    if (!overviewData?.building) setFrozenThinkingText(null);
    setVisibleThinkingLength(0);
  }, [overviewData?.building]);

  const thinkingEntry = diffOverviewProgress?.entries?.find(
    (e) => e.type === 'tool' && e.toolName === 'Thinking'
  );
  const rawThinking = thinkingEntry?.resultSummary || thinkingEntry?.description || '';
  const thinkingBeforeJson = rawThinking ? thinkingTextBeforeJson(rawThinking) : null;

  useEffect(() => {
    if (!overviewData?.building || !thinkingBeforeJson?.jsonStarted) return;
    setFrozenThinkingText((prev) => (prev !== null ? prev : thinkingBeforeJson.text));
    setVisibleThinkingLength((prev) => Math.max(prev, thinkingBeforeJson.text.length));
  }, [overviewData?.building, thinkingBeforeJson?.text, thinkingBeforeJson?.jsonStarted]);

  const displayThinking =
    frozenThinkingText ??
    (thinkingBeforeJson ? thinkingBeforeJson.text : null);

  useEffect(() => {
    if (!displayThinking || !overviewData?.building) return;
    const targetLength = displayThinking.length;
    const id = setInterval(() => {
      setVisibleThinkingLength((prev) => {
        if (prev >= targetLength) return prev;
        return Math.min(prev + STREAMING_CHARS_PER_TICK, targetLength);
      });
    }, STREAMING_TICK_MS);
    return () => clearInterval(id);
  }, [overviewData?.building, displayThinking]);

  const hasChanges = !!diffFiles && diffFiles.length > 0;

  if (isLoading) {
    return (
      <Box style={{ textAlign: 'center', padding: '40px' }}>
        <Loader size="lg" />
        <Text mt="sm">Loading git changes...</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box style={{ textAlign: 'center', padding: '40px' }}>
        <Text color="red">Error loading git changes: {error.message}</Text>
      </Box>
    );
  }

  if (!hasChanges) {
    return (
      <Box style={{ textAlign: 'center', padding: '40px' }}>
        <Title order={3}>No changes detected</Title>
        <Text mt="sm">There are no modified, added, or deleted files in the repository.</Text>
      </Box>
    );
  }

  return (
    <Box
      style={{
        padding: '20px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        gap: 16,
      }}
    >
      {/* Main content: Summary | Changes / Review tabs */}
      <Box
        style={{
          ...CARD_STYLE,
          flex: 3,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: overviewData?.building ? 'auto' : undefined,
        }}
      >
        <Tabs
          defaultValue="summary"
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: overviewData?.building ? 'visible' : 'hidden',
          }}
        >
          <Tabs.List style={{ flexShrink: 0 }}>
            <Tabs.Tab value="summary">Summary</Tabs.Tab>
            <Tabs.Tab value="changes">Changes / Review</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel
            value="summary"
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'visible',
            }}
          >
            <Group
              justify="space-between"
              align="center"
              wrap="wrap"
              gap="sm"
              style={{
                padding: '8px 16px',
                borderBottom: '1px solid var(--app-border)',
                flexShrink: 0,
                position: 'sticky',
                top: 0,
                backgroundColor: 'var(--app-surface)',
                zIndex: 1,
              }}
            >
              <Title order={5} style={{ margin: 0 }}>Summary</Title>
              <Button
                variant="light"
                size="xs"
                loading={invalidateOverview.isPending || overviewData?.building}
                disabled={!!overviewData?.building}
                onClick={() => invalidateOverview.mutate()}
              >
                {overviewData?.building ? 'Analyzing…' : 'Regenerate summary'}
              </Button>
            </Group>
            <Box
              style={
                overviewData?.building
                  ? { flex: 'none', overflow: 'visible' }
                  : { flex: 1, minHeight: 0, overflow: 'auto' }
              }
            >
              {overviewData?.building ? (
                <Box p="md" style={{ overflow: 'visible' }}>
                  <Group gap="sm" align="center" wrap="nowrap" style={{ marginBottom: displayThinking ? 12 : 0 }}>
                    <Loader size="sm" />
                    <Text size="md" c="dimmed">
                      {frozenThinkingText ? 'Preparing summary…' : 'Analyzing your changes…'}
                    </Text>
                  </Group>
                  {diffOverviewProgress?.entries && diffOverviewProgress.entries.length > 0 && displayThinking ? (
                    <div className="chat-thinking-stream markdown-body" role="status" style={{ fontSize: '1rem', lineHeight: 1.6, overflow: 'visible' }}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {displayThinking.slice(0, visibleThinkingLength)}
                      </ReactMarkdown>
                    </div>
                  ) : null}
                </Box>
              ) : overviewData?.error ? (
              <Box p="md">
                <Alert color="orange" title="Summary unavailable">{overviewData.error}</Alert>
                {reviewChatSession?.suggestedImprovements?.length ? (
                  <Stack gap="sm" mt="md">
                    <Text size="lg" fw={600}>Suggested improvements (from chat)</Text>
                    {reviewChatSession.suggestedImprovements.map((imp, i) => (
                      <Box key={i} p="xs" style={{ border: '1px solid var(--app-border)', borderRadius: 6, backgroundColor: 'var(--app-surface)' }}>
                        <Text size="sm" component="div" style={{ fontFamily: 'var(--mono-font)', wordBreak: 'break-all' }}>
                          {imp.filePath}{imp.lineNumber != null ? `:${imp.lineNumber}` : ''}
                        </Text>
                        <Text size="sm" mt={4}>{imp.suggestion}</Text>
                        {imp.snippet ? <Box component="pre" mt="xs" p="xs" style={{ fontSize: '0.75rem', overflow: 'auto', backgroundColor: 'var(--app-bg)', borderRadius: 4 }}>{imp.snippet}</Box> : null}
                      </Box>
                    ))}
                  </Stack>
                ) : null}
              </Box>
            ) : overviewData?.overview ? (
              <Box p="md" style={{ display: 'flex', gap: 24, flex: 1, minHeight: 0, overflow: 'hidden' }}>
                <Box style={{ flex: 1.5, minWidth: 0, overflow: 'auto' }}>
                  <Title order={4} mb="sm">{overviewData.overview.title}</Title>
                  <Text size="md" mb="md" c="dimmed">{overviewData.overview.summary}</Text>
                  <Box className="markdown-body" style={{ fontSize: '1rem', lineHeight: 1.6 }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {overviewData.overview.review || overviewData.overview.summary}
                    </ReactMarkdown>
                  </Box>
                </Box>
                <Box style={{ flex: 1, minWidth: 280, overflow: 'auto', borderLeft: '1px solid var(--app-border)', paddingLeft: 20 }}>
                  <Stack gap="md">
                    {overviewData.overview.confidence && (
                      <Stack gap="sm">
                        <Text size="lg" fw={600}>Confidence</Text>
                        {(['quality', 'testCoverage', 'security'] as const).map((key) => {
                          const dim = overviewData!.overview!.confidence[key];
                          const label = key === 'testCoverage' ? 'Test coverage' : key.charAt(0).toUpperCase() + key.slice(1);
                          return (
                            <Box key={key}>
                              <Group justify="space-between" mb={4}>
                                <Text size="sm" fw={500}>{label}</Text>
                                <Text size="sm" c="dimmed">{dim.score}%</Text>
                              </Group>
                              <Progress value={dim.score} size="sm" color={dim.score >= 70 ? 'green' : dim.score >= 40 ? 'yellow' : 'red'} mb={4} />
                              <Text size="xs" c="dimmed" mb={2}>{dim.explanation}</Text>
                              {dim.evidence ? (
                                <Text size="xs" c="dimmed" style={{ fontStyle: 'italic' }}>Evidence: {dim.evidence}</Text>
                              ) : null}
                            </Box>
                          );
                        })}
                      </Stack>
                    )}
                    {overviewData.overview.keyFiles.length > 0 && (
                      <Stack gap="xs">
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
                        <Text size="lg" fw={600}>Things to look for</Text>
                        <List size="lg" spacing="xs">
                          {overviewData.overview.actionItems.map((item, i) => (
                            <List.Item key={i}>
                              <LevelBadge level={item.level} />
                              <Text component="span" size="md" ml="xs">{item.text}</Text>
                              {item.files?.length ? (
                                <Text size="xs" c="dimmed" ml="xs" component="span">({item.files.join(', ')})</Text>
                              ) : null}
                            </List.Item>
                          ))}
                        </List>
                      </Stack>
                    )}
                    {reviewChatSession?.suggestedImprovements?.length ? (
                      <Stack gap="xs">
                        <Text size="lg" fw={600}>Suggested improvements (from chat)</Text>
                        <Stack gap="sm">
                          {reviewChatSession.suggestedImprovements.map((imp, i) => (
                            <Box key={i} p="xs" style={{ border: '1px solid var(--app-border)', borderRadius: 6, backgroundColor: 'var(--app-surface)' }}>
                              <Text size="sm" component="div" style={{ fontFamily: 'var(--mono-font)', wordBreak: 'break-all' }}>
                                {imp.filePath}{imp.lineNumber != null ? `:${imp.lineNumber}` : ''}
                              </Text>
                              <Text size="sm" mt={4}>{imp.suggestion}</Text>
                              {imp.snippet ? (
                                <Box component="pre" mt="xs" p="xs" style={{ fontSize: '0.75rem', overflow: 'auto', backgroundColor: 'var(--app-bg)', borderRadius: 4 }}>{imp.snippet}</Box>
                              ) : null}
                            </Box>
                          ))}
                        </Stack>
                      </Stack>
                    ) : null}
                  </Stack>
                </Box>
              </Box>
            ) : reviewChatSession?.suggestedImprovements?.length ? (
              <Box p="md">
                <Text size="lg" fw={600} mb="sm">Suggested improvements (from chat)</Text>
                <Stack gap="sm">
                  {reviewChatSession.suggestedImprovements.map((imp, i) => (
                    <Box key={i} p="xs" style={{ border: '1px solid var(--app-border)', borderRadius: 6, backgroundColor: 'var(--app-surface)' }}>
                      <Text size="sm" component="div" style={{ fontFamily: 'var(--mono-font)', wordBreak: 'break-all' }}>
                        {imp.filePath}{imp.lineNumber != null ? `:${imp.lineNumber}` : ''}
                      </Text>
                      <Text size="sm" mt={4}>{imp.suggestion}</Text>
                      {imp.snippet ? <Box component="pre" mt="xs" p="xs" style={{ fontSize: '0.75rem', overflow: 'auto', backgroundColor: 'var(--app-bg)', borderRadius: 4 }}>{imp.snippet}</Box> : null}
                    </Box>
                  ))}
                </Stack>
              </Box>
            ) : null}
            </Box>
          </Tabs.Panel>
          <Tabs.Panel value="changes" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Group
              justify="space-between"
              align="flex-end"
              wrap="wrap"
              gap="sm"
              style={{ padding: '12px 16px', borderBottom: '1px solid var(--app-border)', flexShrink: 0 }}
            >
              <Box>
                <Title order={5} style={{ margin: 0 }}>Git Changes</Title>
                <Text size="sm" c="dimmed" mt={4}>
                  {reviewSession
                    ? 'Review session active — click any line to add a comment.'
                    : 'Start a review to add comments on specific lines.'}
                </Text>
              </Box>
              {!reviewSession && (
                <Button
                  onClick={() => startReviewMutation.mutate()}
                  loading={startReviewMutation.isPending}
                  disabled={!hasChanges}
                >
                  Start new review
                </Button>
              )}
            </Group>
            {startReviewMutation.isError && (
              <Alert
                color="red"
                m="sm"
                mx="md"
                onClose={() => startReviewMutation.reset()}
                style={{ flexShrink: 0 }}
              >
                {startReviewMutation.error.message}
              </Alert>
            )}
            <Box style={{ flex: 1, minHeight: 0 }}>
              <DiffViewer
                diffFiles={diffFiles}
                activeFile={activeFile}
                onFileSelect={setActiveFile}
                sessionId={reviewSession?.id ?? null}
                comments={reviewSession?.comments ?? []}
                onCommentAdded={refetchReview}
              />
            </Box>
          </Tabs.Panel>
        </Tabs>
      </Box>

      {/* Bottom panel: Assistant chat (~25%) */}
      <Box
        style={{
          ...CARD_STYLE,
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <ReviewAssistantPanel sessionId={reviewChatSessionId} />
      </Box>
    </Box>
  );
}

export default DiffViewerPage;