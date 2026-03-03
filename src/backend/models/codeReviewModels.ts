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

/**
 * Represents a single file with line-by-line changes from git diff
 */
export interface GitDiffFile {
  path: string;          // Relative path from repo root
  status: 'M' | 'A' | 'D' | 'R' | 'C' | '??'; // git status code
  hunks: GitDiffHunk[];  // List of change blocks
}

/**
 * Represents a block of changed lines in a file
 */
export interface GitDiffHunk {
  header: string;        // e.g. "@@ -10,7 +10,8 @@"
  lines: GitDiffLine[];  // Each line in the hunk
}

/**
 * Represents a single line in a git diff
 */
export interface GitDiffLine {
  type: 'context' | 'add' | 'remove'; // Line type in diff
  content: string;                    // Raw line content
  lineNumber: number;                 // Line number in target (post-change) file
  oldLineNumber?: number;             // Line number in source (pre-change) file (for 'add' and 'context')
}

/**
 * A user comment on a specific line in a diff
 */
export interface CodeReviewComment {
  id: string;                    // UUID
  fileId: string;                // Path to file (same as GitDiffFile.path)
  lineNumber: number;            // Target line number in the file (post-change)
  text: string;                  // User's comment
  createdAt: Date;
  updatedAt?: Date;
  isResolved?: boolean;
}

/**
 * An assistant reply to a comment or set of comments
 */
export interface AssistantResponse {
  id: string;                    // UUID
  commentIds: string[];          // IDs of comments this response addresses
  type: 'suggestion' | 'question' | 'clarification';
  content: string;               // Free-form text
  suggestedChanges?: SuggestedChange[]; // Optional: code changes proposed
  createdAt: Date;
}

/**
 * A proposed code change from the assistant
 */
export interface SuggestedChange {
  path: string;                  // File path
  hunk: string;                  // Unified diff hunk (as string)
  explanation: string;           // Why this change was suggested
}

/**
 * Stores the entire review state
 */
export interface CodeReviewSession {
  id: string;                    // UUID
  repoPath: string;              // Path to git repo
  baseCommit?: string;           // Optional: diff against specific commit
  headCommit: string;            // Current HEAD commit
  diffFiles: GitDiffFile[];      // All changed files
  comments: CodeReviewComment[];
  responses: AssistantResponse[];
  createdAt: Date;
  updatedAt: Date;
  status: 'draft' | 'reviewing' | 'ready-for-plan' | 'completed';
}

/**
 * Final implementation plan generated from completed review
 */
export interface FinalImplementationPlan {
  title: string; // e.g. "Refactor auth service and fix token expiration"
  summary: string; // 1-2 sentence overview
  changes: {
    path: string;
    description: string;
    diffHunk: string;
    relatedComments: string[]; // IDs of comments that led to this change
  }[];
  rationale: string; // Why these changes are necessary and sufficient
}
