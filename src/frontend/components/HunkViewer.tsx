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

import React, { useState } from 'react';
import {
  Box,
  Text,
  ScrollArea,
  Title,
  Button,
  Textarea,
  Group,
  Modal,
  Stack,
  ActionIcon,
} from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { GitDiffFile } from '../../shared/types';
import type { DiffComment } from '../../shared/types';
import { DiffLine } from './DiffLine';
import { trpc } from '../../client/trpc';

interface HunkViewerProps {
  diffFiles: GitDiffFile[];
  activeFile: string;
  sessionId: string | null;
  comments: DiffComment[];
  onCommentAdded: () => void;
}

export function HunkViewer({
  diffFiles,
  activeFile,
  sessionId,
  comments,
  onCommentAdded,
}: HunkViewerProps) {
  const file = diffFiles.find((f) => f.path === activeFile);
  const [addingFor, setAddingFor] = useState<{ lineNumber: number } | null>(null);
  const [commentDraft, setCommentDraft] = useState('');

  const utils = trpc.useUtils();
  const addCommentMutation = trpc.review.addComment.useMutation({
    onSuccess: () => {
      utils.review.getOrCreateSession.invalidate();
      onCommentAdded();
      setAddingFor(null);
      setCommentDraft('');
    },
  });

  const deleteCommentMutation = trpc.review.deleteComment.useMutation({
    onSuccess: () => {
      utils.review.getOrCreateSession.invalidate();
      onCommentAdded();
    },
  });

  const openCommentDialog = (lineNumber: number) => {
    if (!sessionId) return;
    setAddingFor({ lineNumber });
    setCommentDraft('');
  };

  const closeCommentDialog = () => {
    setAddingFor(null);
    setCommentDraft('');
  };

  if (!file) {
    return <Text>No file found</Text>;
  }

  const commentsForLine = (lineNumber: number) =>
    comments.filter((c) => c.fileId === file.path && c.lineNumber === lineNumber && !c.isResolved);

  const handleSubmitComment = (lineNumber: number) => {
    if (!sessionId || !commentDraft.trim()) return;
    addCommentMutation.mutate({
      sessionId,
      fileId: file.path,
      lineNumber,
      text: commentDraft.trim(),
    });
  };

  return (
    <Box
      style={{
        padding: '16px 20px',
        height: '100%',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Text
        size="sm"
        fw={600}
        style={{ marginBottom: 12, letterSpacing: '0.01em', color: 'var(--app-text-heading)' }}
      >
        {file.path}
        <Text component="span" size="xs" fw={500} c="dimmed" ml={6}>
          {file.status}
        </Text>
      </Text>

      <ScrollArea style={{ flex: 1 }}>
        {file.hunks.map((hunk, hunkIndex) => (
          <Box key={hunkIndex} style={{ marginBottom: 16 }}>
            <Text
              size="xs"
              c="dimmed"
              style={{
                backgroundColor: 'var(--app-hover)',
                padding: '4px 10px',
                borderRadius: 4,
                marginBottom: 8,
              }}
            >
              {hunk.header}
            </Text>

            {hunk.lines.map((line, lineIndex) => (
              <Box key={lineIndex}>
                <Box
                  style={{
                    width: '100%',
                    cursor: sessionId ? 'pointer' : undefined,
                  }}
                  onClick={() => openCommentDialog(line.lineNumber)}
                  role={sessionId ? 'button' : undefined}
                  aria-label={sessionId ? `Add comment on line ${line.lineNumber}` : undefined}
                >
                  <DiffLine line={line} />
                </Box>
                {commentsForLine(line.lineNumber).map((c) => (
                  <Group
                    key={c.id}
                    gap="xs"
                    align="flex-start"
                    style={{
                      padding: '6px 10px',
                      marginLeft: 10,
                      marginBottom: 6,
                      backgroundColor: 'var(--app-accent-bg)',
                      borderLeft: '3px solid var(--app-accent)',
                      borderRadius: '0 4px 4px 0',
                    }}
                  >
                    <Text size="sm" style={{ flex: 1, minWidth: 0 }}>{c.text}</Text>
                    {sessionId && (
                      <ActionIcon
                        variant="subtle"
                        size="sm"
                        color="red"
                        onClick={() =>
                          deleteCommentMutation.mutate({ sessionId, commentId: c.id })
                        }
                        loading={deleteCommentMutation.isPending}
                        aria-label="Remove comment"
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    )}
                  </Group>
                ))}
              </Box>
            ))}
          </Box>
        ))}
      </ScrollArea>

      <Modal
        opened={addingFor !== null}
        onClose={closeCommentDialog}
        title="Add comment"
      >
        <Stack gap="md">
          {addingFor !== null && (
            <>
              <Text size="sm" c="dimmed">
                Line {addingFor.lineNumber} in {file.path}
              </Text>
              <Textarea
                placeholder="Write your comment..."
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.currentTarget.value)}
                minRows={3}
                autoFocus
              />
              <Group justify="flex-end">
                <Button variant="default" onClick={closeCommentDialog}>
                  Cancel
                </Button>
                <Button
                  onClick={() => addingFor && handleSubmitComment(addingFor.lineNumber)}
                  loading={addCommentMutation.isPending}
                  disabled={!commentDraft.trim()}
                >
                  Save comment
                </Button>
              </Group>
            </>
          )}
        </Stack>
      </Modal>
    </Box>
  );
}