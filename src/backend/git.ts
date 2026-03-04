/*
 * Copyright 2026 John Ewart <john@johnewart.net>
 *
 * Licensed under the Apache License, Version 2.0 (the \"License\");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an \"AS IS\" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { execSync } from 'child_process';
import * as path from 'path';

export interface GitFileChange {
  path: string;
  added: number;
  removed: number;
  status: 'M' | 'A' | 'D' | 'R' | 'C' | '??';
}

// Export type alias for convenience
export type GitStatus = 'M' | 'A' | 'D' | 'R' | 'C' | '??';

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
 * Check if git is available in the system PATH
 */
export function isGitAvailable(): boolean {
  try {
    execSync('git --version', { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the git repository root starting from the given path
 */
export function getGitRepoPath(startPath: string): string | null {
  try {
    const result = execSync('git rev-parse --show-toplevel', {
      cwd: startPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.toString().trim();
  } catch {
    return null;
  }
}

/**
 * Check if the given path is a git repository
 */
export function isGitRepository(path: string): boolean {
  try {
    const result = execSync('git rev-parse --git-dir', {
      cwd: path,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.toString().trim() !== '';
  } catch {
    return false;
  }
}

/**
 * Get the status of all changed files in the repository
 */
export function getChangedFiles(repoPath: string): GitFileChange[] {
  // First, resolve to actual Git repo root
  const actualRepoPath = getGitRepoPath(repoPath);
  if (!actualRepoPath) {
    return []; // Not in a Git repo
  }

  try {
    // Get status with porcelain format for machine-readable output
    const statusOutput = execSync('git status --porcelain=v1', {
      cwd: actualRepoPath, // Use the discovered root, not the input!
      encoding: 'utf-8',
    });
    
    // Debug: Log the raw output
    console.log('Git status output:', '\n' + statusOutput);

    const changes: GitFileChange[] = [];

    for (const line of statusOutput.split('\n')) {
      if (!line.trim()) continue;

      // Parse porcelain v1 format: "XY PATH" where XY is status code
      // X = status of index (first char), Y = status of working tree (second char)
      // Both positions can be: letter (status) or space (no change)
      // Format examples: " M file.txt" (modified, unstaged), "A  file.txt" (added, staged)
      // Or "??" for untracked files
      
      // For untracked files: "?? path"
      if (line.startsWith('??')) {
        const filePath = line.substring(2).trim();
        changes.push({
          path: filePath,
          added: 0,
          removed: 0,
          status: '??'
        });
        continue;
      }
      
      // For other cases: "XY path" or "R old -> new"
      if (line.length >= 3) {
        const firstChar = line[0];
        const secondChar = line[1];
        let filePath = line.substring(2).trim();

        // Handle rename format: "R old -> new"
        // We want to return only the new file path for R status
        if (firstChar === 'R' && filePath.includes(' -> ')) {
          // Split on ' -> ' and take the second part (new file path)
          const parts = filePath.split(' -> ');
          if (parts.length === 2) {
            filePath = parts[1].trim();
          }
        }

        let status: GitFileChange['status'];
        
        if (secondChar === ' ') {
          // Working tree unchanged, use index status
          switch (firstChar) {
            case 'M': status = 'M'; break;
            case 'A': status = 'A'; break;
            case 'D': status = 'D'; break;
            case 'R': status = 'R'; break;
            case 'C': status = 'C'; break;
            default: continue;
          }
        } else {
          // Use working tree status (unstaged)
          switch (secondChar) {
            case 'M': status = 'M'; break;
            case 'A': status = 'A'; break;
            case 'D': status = 'D'; break;
            case '?': status = '??'; break;
            default: continue; // Ignore invalid R/C here — they can't appear in working tree status
          }
        }

        changes.push({
          path: filePath,
          added: 0,
          removed: 0,
          status,
        });
      }
    }

    return changes;
  } catch (error) {
    // Log error in development; return empty in production
    console.error('Failed to get Git changes:', error);
    return [];
  }
}

/**
 * Get the diff stats for a specific file
 */
export function getDiffStats(repoPath: string, filePath: string): {
  added: number;
  removed: number;
} {
  if (!isGitRepository(repoPath)) {
    return { added: 0, removed: 0 };
  }

  try {
    // Get diff stats for the file
    const diffOutput = execSync(`git diff --shortstat "${filePath}"`, {
      cwd: repoPath,
      encoding: 'utf-8',
    });

    let added = 0;
    let removed = 0;

    // Parse output like "1 file changed, 5 insertions(+), 2 deletions(-)"
    // Or for untracked files, we need different approach
    if (diffOutput.trim()) {
      const addMatch = diffOutput.match(/(\d+) insertion/i);
      const delMatch = diffOutput.match(/(\d+) deletion/i);

      added = addMatch ? parseInt(addMatch[1], 10) : 0;
      removed = delMatch ? parseInt(delMatch[1], 10) : 0;
    }

    // For untracked files, we need to calculate lines from content
    if (added === 0 && removed === 0) {
      try {
        const fullPath = path.join(repoPath, filePath);
        const content = execSync(`git show :${filePath}`, {
          cwd: repoPath,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        // This is an existing file, get diff from working tree
      } catch {
        // File doesn't exist in git, it's new
        // We'll get the actual stats when showing the file
      }
    }

    return { added, removed };
  } catch {
    // If diff fails, try to get stats from the working tree
    try {
      const fullPath = path.join(repoPath, filePath);
      const content = require('fs').readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      // For untracked/new files, show all lines as added
      // We'll return 0 here and handle it in UI
      return { added: 0, removed: 0 };
    } catch {
      return { added: 0, removed: 0 };
    }
  }
}

/**
 * Get comprehensive diff stats for all changed files
 */
export function getComprehensiveDiffStats(
  repoPath: string
): Map<string, { added: number; removed: number }> {
  const stats = new Map<string, { added: number; removed: number }>();

  if (!isGitRepository(repoPath)) {
    return stats;
  }

  try {
    // Get all changed files
    const changes = getChangedFiles(repoPath);

    for (const change of changes) {
      let added = 0;
      let removed = 0;

      try {
        if (change.status === 'A' || change.status === '??') {
          // New or untracked file - get all lines from current content
          const fullPath = path.join(repoPath, change.path);
          if (require('fs').existsSync(fullPath)) {
            const content = require('fs').readFileSync(fullPath, 'utf-8');
            added = content.split('\n').length;
          }
        } else if (change.status === 'D') {
          // Deleted file - get all lines from git
          try {
            const content = execSync(`git show HEAD:"${change.path}"`, {
              cwd: repoPath,
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe'],
            });
            removed = content.split('\n').length;
          } catch {
            // File not in HEAD, try index
            try {
              const content = execSync(`git show :${change.path}`, {
                cwd: repoPath,
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
              });
              removed = content.split('\n').length;
            } catch {
              removed = 0;
            }
          }
        } else {
          // Modified file - use git diff --shortstat
          try {
            const diffOutput = execSync(
              `git diff --shortstat "${change.path}"`,
              {
                cwd: repoPath,
                encoding: 'utf-8',
              }
            );

            const addMatch = diffOutput.match(/(\d+) insertion/i);
            const delMatch = diffOutput.match(/(\d+) deletion/i);

            added = addMatch ? parseInt(addMatch[1], 10) : 0;
            removed = delMatch ? parseInt(delMatch[1], 10) : 0;
          } catch {
            // Fall back to content comparison
            try {
              const content = require('fs').readFileSync(
                path.join(repoPath, change.path),
                'utf-8'
              );
              added = content.split('\n').length;
            } catch {
              added = 0;
            }
          }
        }
      } catch {
        // If anything fails, use zeros
        added = 0;
        removed = 0;
      }

      stats.set(change.path, { added, removed });
    }
  } catch {
    // If anything fails, return empty map
  }

  return stats;
}

/**
 * Extract line numbers from git diff hunk header
 * @param header Example: "@@ -10,7 +10,8 @@"
 * @param isTarget true for target (new) file line number, false for source (old) file
 * @returns The line number in the specified file
 */
function getLineNumFromHunkHeader(header: string, isTarget: boolean): number {
  if (isTarget) {
    // Pattern for target (new) file: @@ -a,b +c,d @@
    const match = header.match(/@@ -\d+,\d+ \+(\d+),\d+ @@/);
    if (match) return parseInt(match[1], 10);
  } else {
    // Pattern for source (old) file: @@ -a,b +c,d @@
    const match = header.match(/@@ -(\d+),\d+ \+\d+,\d+ @@/);
    if (match) return parseInt(match[1], 10);
  }
  // Default fallback
  return 1;
}

/**
 * Get line-by-line git diff of all changed files in the repository
 * Returns structured diff with line numbers and types (add/remove/context)
 */
export function getGitDiff(repoPath: string = '.'): GitDiffFile[] {
  if (!isGitRepository(repoPath)) {
    return [];
  }

  try {
    // Get list of changed files
    const statusOutput = execSync('git status --porcelain=v1', {
      cwd: repoPath,
      encoding: 'utf-8',
    });

    const changedFiles: GitDiffFile[] = [];

    for (const line of statusOutput.split('\n')) {
      if (!line.trim()) continue;
      const match = line.match(/^([AMDR?C])\s+(.+)$/);
      if (!match) continue;

      const status = match[1] as GitStatus;
      const filePath = match[2];

      // Get unified diff for this file
      const diffOutput = execSync(`git diff -U10 --no-color -- "${filePath}"`, {
        cwd: repoPath,
        encoding: 'utf-8',
      });

      const hunks: GitDiffHunk[] = [];
      const lines = diffOutput.split('\n');

      let currentHunk: GitDiffHunk | null = null;

      for (const line of lines) {
        if (line.startsWith('@@')) {
          // Start of new hunk
          currentHunk = { header: line, lines: [] };
          hunks.push(currentHunk);
        } else if (currentHunk) {
          if (line.startsWith('+')) {
            // Added line (target file)
            const lineNumber = getLineNumFromHunkHeader(currentHunk.header, true);
            currentHunk.lines.push({
              type: 'add',
              content: line.substring(1),
              lineNumber,
            });
            // Update line number for next line
            currentHunk.lines[currentHunk.lines.length - 1].lineNumber++;
          } else if (line.startsWith('-')) {
            // Removed line (source file)
            const lineNumber = getLineNumFromHunkHeader(currentHunk.header, false);
            currentHunk.lines.push({
              type: 'remove',
              content: line.substring(1),
              lineNumber,
              oldLineNumber: lineNumber,
            });
            // Update line number for next line
            currentHunk.lines[currentHunk.lines.length - 1].oldLineNumber++;
          } else if (line.startsWith(' ')) {
            // Context line
            const targetLineNum = getLineNumFromHunkHeader(currentHunk.header, true);
            const sourceLineNum = getLineNumFromHunkHeader(currentHunk.header, false);
            currentHunk.lines.push({
              type: 'context',
              content: line.substring(1),
              lineNumber: targetLineNum,
              oldLineNumber: sourceLineNum,
            });
            // Update line numbers for next line
            currentHunk.lines[currentHunk.lines.length - 1].lineNumber++;
            currentHunk.lines[currentHunk.lines.length - 1].oldLineNumber++;
          }
          // Ignore other lines like \ No newline at end of file
        }
      }

      changedFiles.push({
        path: filePath,
        status,
        hunks,
      });
    }

    return changedFiles;
  } catch (error) {
    console.error('Error getting git diff:', error);
    return [];
  }
}