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
  if (!isGitRepository(repoPath)) {
    return [];
  }

  try {
    // Get status with porcelain format for machine-readable output
    const statusOutput = execSync('git status --porcelain=v1', {
      cwd: repoPath,
      encoding: 'utf-8',
    });

    const changes: GitFileChange[] = [];

    for (const line of statusOutput.split('\n')) {
      if (!line.trim()) continue;

      // Parse porcelain v1 format: "XY PATH" where XY is status code
      // X = status of index (first char), Y = status of working tree (second char)
      // Both positions can be: letter (status) or space (no change)
      // Format examples: " M file.txt" (modified, unstaged), "A  file.txt" (added, staged)
      // Or "??" for untracked files
      
      // Match format: optional space, then 2 status chars, then space, then path
      const match = line.match(/^(\s?)(.)(.)\s+(.+)$/);
      if (!match) continue;

      // Match groups:
      // [0] = full line
      // [1] = optional leading space
      // [2] = first char of status (index status)
      // [3] = second char of status (working tree status)
      // [4] = filepath
      const firstChar = match[2];
      const secondChar = match[3];
      const filePath = match[4];

      // Get the working tree status (second char)
      // If it's a space, the first char indicates index status only (file unchanged in working tree)
      // Otherwise, second char is the working tree status
      const statusChar = secondChar === ' ' ? firstChar : secondChar;

      let status: GitFileChange['status'];
      switch (statusChar) {
        case 'M': // Modified
          status = 'M';
          break;
        case 'A': // Added
          status = 'A';
          break;
        case 'D': // Deleted
          status = 'D';
          break;
        case 'R': // Renamed
          status = 'R';
          break;
        case 'C': // Copied
          status = 'C';
          break;
        case '?': // Untracked (from first char if second is space)
          status = '??';
          break;
        default:
          continue; // Skip unhandled statuses
      }

      changes.push({
        path: filePath.trim(),
        added: 0,
        removed: 0,
        status,
      });
    }

    return changes;
  } catch {
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
