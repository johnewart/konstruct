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
import { Box, Loader, Text, Title, Button, Group, Alert } from '@mantine/core';
import { trpc } from '../../client/trpc';
import { DiffViewer } from '../components/DiffViewer';
import { ReviewAssistantPanel } from '../components/ReviewAssistantPanel';

const CARD_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--app-surface)',
  border: '1px solid var(--app-border)',
  borderRadius: 8,
  boxShadow: '0 2px 8px var(--app-shadow)',
  overflow: 'hidden',
};

export function DiffViewerPage() {
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [reviewChatSessionId, setReviewChatSessionId] = useState<string | null>(null);

  const { data: diffFiles, isLoading, error } = trpc.git.getGitDiff.useQuery();
  const utils = trpc.useUtils();
  const createReviewChatSession = trpc.sessions.create.useMutation({
    onSuccess: (session) => setReviewChatSessionId(session.id),
  });
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
      createReviewChatSession.mutate({ title: 'Code review' });
  }, [diffFiles?.length, reviewChatSessionId]);

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
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 60px)',
        minHeight: 0,
        gap: 16,
      }}
    >
      {/* Top panel: Git changes / diff (~75%) */}
      <Box
        style={{
          ...CARD_STYLE,
          flex: 3,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Group
          justify="space-between"
          align="flex-end"
          wrap="wrap"
          gap="sm"
          style={{ padding: '12px 16px', borderBottom: '1px solid var(--app-border)', flexShrink: 0 }}
        >
          <Box>
            <Title order={3}>Git Changes</Title>
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