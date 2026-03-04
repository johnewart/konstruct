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

import { z } from 'zod';
import { router, publicProcedure } from '../trpc/trpc';
import { loadGlobalConfig, saveGlobalConfig, getGitHubToken } from '../../shared/config';
import { getRemoteOriginUrl, parseGitHubRepoFromUrl, isGitRepository, parsePatchToHunks } from '../git';
import type { GitDiffFile } from '../git';

const GITHUB_API = 'https://api.github.com';

export interface GitHubPullRequest {
  number: number;
  title: string;
  state: string;
  html_url: string;
  user: { login: string; avatar_url?: string };
  created_at: string;
  updated_at: string;
  body: string | null;
  head: { ref: string };
  base: { ref: string };
}

async function fetchGitHub<T>(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: token ? `Bearer ${token}` : '',
      ...(options.headers as Record<string, string>),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${res.status}: ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const githubRouter = router({
  /** Resolve GitHub owner/repo from the current project's git origin. Null if not a GitHub repo. */
  getRepo: publicProcedure.query(({ ctx }) => {
    const root = ctx.projectRoot;
    if (!root || !isGitRepository(root)) return null;
    const url = getRemoteOriginUrl(root);
    if (!url) return null;
    return parseGitHubRepoFromUrl(url);
  }),

  /** Whether a GitHub token is configured (central config). */
  getTokenStatus: publicProcedure.query(() => {
    const token = getGitHubToken();
    return { configured: !!token };
  }),

  /** Store GitHub token in global config. */
  setToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(({ input }) => {
      const config = loadGlobalConfig();
      config.github = { token: input.token.trim() };
      saveGlobalConfig(config);
      return { ok: true };
    }),

  /** List open pull requests for the current project (requires GitHub origin and configured token). */
  listPullRequests: publicProcedure
    .input(
      z
        .object({
          state: z.enum(['open', 'closed', 'all']).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const root = ctx.projectRoot;
      if (!root || !isGitRepository(root)) {
        return { error: 'not_a_repo' as const, pullRequests: [] };
      }
      const url = getRemoteOriginUrl(root);
      const repo = url ? parseGitHubRepoFromUrl(url) : null;
      if (!repo) {
        return { error: 'not_github' as const, pullRequests: [] };
      }
      const token = getGitHubToken();
      if (!token) {
        return { error: 'token_required' as const, pullRequests: [] };
      }
      const state = input?.state ?? 'open';
      try {
        const pulls = await fetchGitHub<GitHubPullRequest[]>(
          `/repos/${repo.owner}/${repo.repo}/pulls?state=${state}&per_page=100`,
          token
        );
        return {
          error: null,
          repo: { owner: repo.owner, repo: repo.repo },
          pullRequests: pulls.map((p) => ({
            number: p.number,
            title: p.title,
            state: p.state,
            htmlUrl: p.html_url,
            user: p.user?.login ?? '',
            createdAt: p.created_at,
            updatedAt: p.updated_at,
            body: p.body,
            headRef: p.head?.ref,
            baseRef: p.base?.ref,
          })),
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          error: 'api_error' as const,
          pullRequests: [],
          message,
        };
      }
    }),

  /** Get the diff for a pull request as GitDiffFile[] (for display in diff viewer). */
  getPullRequestDiff: publicProcedure
    .input(z.object({ pullNumber: z.number().int().positive() }))
    .query(async ({ ctx, input }): Promise<{ error: string | null; diffFiles: GitDiffFile[]; message?: string }> => {
      const root = ctx.projectRoot;
      if (!root || !isGitRepository(root)) {
        return { error: 'not_a_repo', diffFiles: [] };
      }
      const url = getRemoteOriginUrl(root);
      const repo = url ? parseGitHubRepoFromUrl(url) : null;
      if (!repo) return { error: 'not_github', diffFiles: [] };
      const token = getGitHubToken();
      if (!token) return { error: 'token_required', diffFiles: [] };
      try {
        const files = await fetchGitHub<Array<{ filename: string; status: string; patch: string | null }>>(
          `/repos/${repo.owner}/${repo.repo}/pulls/${input.pullNumber}/files`,
          token
        );
        const statusMap: Record<string, GitDiffFile['status']> = {
          added: 'A',
          removed: 'D',
          modified: 'M',
          changed: 'M',
          renamed: 'R',
          copied: 'C',
        };
        const diffFiles: GitDiffFile[] = files.map((f) => {
          const status = statusMap[f.status] ?? 'M';
          const hunks = f.patch ? parsePatchToHunks(f.patch) : [];
          return {
            path: f.filename,
            status,
            hunks,
          };
        });
        return { error: null, diffFiles };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return { error: 'api_error', diffFiles: [], message };
      }
    }),
});

/**
 * Fetch PR title, body, and diff and return a single string for agent context.
 * Used when the user is chatting about a PR so the agent has the full PR in context.
 */
export async function getPRContextForAgent(
  projectRoot: string,
  pullNumber: number
): Promise<string> {
  if (!projectRoot || !isGitRepository(projectRoot)) return '';
  const url = getRemoteOriginUrl(projectRoot);
  const repo = url ? parseGitHubRepoFromUrl(url) : null;
  if (!repo) return '';
  const token = getGitHubToken();
  if (!token) return '';

  const [pr, files] = await Promise.all([
    fetchGitHub<GitHubPullRequest>(
      `/repos/${repo.owner}/${repo.repo}/pulls/${pullNumber}`,
      token
    ),
    fetchGitHub<Array<{ filename: string; status: string; patch: string | null }>>(
      `/repos/${repo.owner}/${repo.repo}/pulls/${pullNumber}/files`,
      token
    ),
  ]);

  const statusMap: Record<string, string> = {
    added: 'A',
    removed: 'D',
    modified: 'M',
    changed: 'M',
    renamed: 'R',
    copied: 'C',
  };
  const diffFiles: GitDiffFile[] = files.map((f) => {
    const status = (statusMap[f.status] ?? 'M') as GitDiffFile['status'];
    const hunks = f.patch ? parsePatchToHunks(f.patch) : [];
    return { path: f.filename, status, hunks };
  });

  const diffText = diffFiles
    .map((file) => {
      const hunksText = file.hunks
        .map((hunk) => hunk.header + '\n' + hunk.lines.map((l) => l.content).join('\n'))
        .join('\n');
      return `### ${file.path} (${file.status})\n${hunksText}`;
    })
    .join('\n\n');

  const body = (pr.body ?? '').trim();
  const parts = [
    `# Pull request #${pullNumber}: ${pr.title}`,
    pr.base?.ref && pr.head?.ref ? `Base: ${pr.base.ref} → Head: ${pr.head.ref}` : '',
    body ? `\n## Description\n${body}` : '',
    diffText ? `\n## Diff\n\n${diffText}` : '',
  ];
  return parts.filter(Boolean).join('\n').trim();
}
