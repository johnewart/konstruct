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

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { router, publicProcedure } from '../trpc/trpc';
import { loadGlobalConfig, saveGlobalConfig, getGitHubToken, getGlobalConfigDir } from '../../shared/config';
import { getRemoteOriginUrl, parseGitHubRepoFromUrl, isGitRepository, parsePatchToHunks } from '../git';
import type { GitDiffFile } from '../git';
import { getCachedDependencyGraph } from './codebase';
import { chat } from '../../shared/llm';
import { getAllProviders } from '../../shared/providers';
import * as sessionStore from '../../shared/sessionStore';

const GITHUB_API = 'https://api.github.com';

/** One "thing to look for" with optional relevant files. */
export interface PROverviewActionItem {
  text: string;
  level: 'high' | 'medium' | 'low';
  files?: string[];
}

/** Result of PR overview summarizer (title, summary, key files with danger, action items). */
export interface PROverviewResult {
  title: string;
  summary: string;
  keyFiles: Array<{ path: string; dangerLevel: string; reason?: string }>;
  actionItems: PROverviewActionItem[];
}

const overviewCache = new Map<string, PROverviewResult>();
const overviewBuilding = new Set<string>();

function overviewKey(projectRoot: string, pullNumber: number): string {
  return `${projectRoot}|${pullNumber}`;
}

const PR_OVERVIEW_CACHE_DIR = 'pr-overviews';

/** Path to cached PR overview file under ~/.config/konstruct/projects/<projectId>/cache/pr-overviews/ */
function getPROverviewCachePath(projectId: string, pullNumber: number): string {
  return path.join(
    getGlobalConfigDir(),
    'projects',
    projectId,
    'cache',
    PR_OVERVIEW_CACHE_DIR,
    `${pullNumber}.json`
  );
}

function normalizeActionItem(raw: unknown): PROverviewActionItem {
  if (raw && typeof raw === 'object' && 'text' in raw && typeof (raw as { text: unknown }).text === 'string') {
    const o = raw as { text: string; level?: string; files?: unknown };
    const level = o.level === 'high' || o.level === 'medium' || o.level === 'low' ? o.level : 'medium';
    const files = Array.isArray(o.files) ? o.files.filter((f): f is string => typeof f === 'string') : [];
    return { text: o.text, level, files };
  }
  if (typeof raw === 'string') return { text: raw, level: 'medium', files: [] };
  return { text: String(raw), level: 'medium', files: [] };
}

function readPROverviewFromCache(projectId: string, pullNumber: number): PROverviewResult | null {
  const filePath = getPROverviewCachePath(projectId, pullNumber);
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as Record<string, unknown>;
    const keyFiles = Array.isArray(data.keyFiles)
      ? (data.keyFiles as Array<{ path?: string; dangerLevel?: string; reason?: string }>).map((k) => ({
          path: String(k?.path ?? ''),
          dangerLevel: String(k?.dangerLevel ?? ''),
          reason: k?.reason != null ? String(k.reason) : undefined,
        }))
      : [];
    const actionItems = Array.isArray(data.actionItems) ? data.actionItems.map(normalizeActionItem) : [];
    return {
      title: data.title as string,
      summary: data.summary as string,
      keyFiles,
      actionItems,
    };
  } catch {
    return null;
  }
}

function writePROverviewToCache(projectId: string, pullNumber: number, overview: PROverviewResult): void {
  const filePath = getPROverviewCachePath(projectId, pullNumber);
  const dir = path.dirname(filePath);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(overview, null, 0), 'utf-8');
  } catch (err) {
    console.warn('[PR overview] failed to write cache', filePath, err);
  }
}

function deletePROverviewCache(projectId: string, pullNumber: number): void {
  const filePath = getPROverviewCachePath(projectId, pullNumber);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

/** Compute inbound file paths for each path in diffFiles from the dependency graph. */
function inboundDepsForDiffFiles(
  diffFiles: Array<{ path: string }>,
  edges: Array<{ source: string; target: string }>
): Map<string, string[]> {
  const norm = (p: string) => p.replace(/\\/g, '/').trim();
  const byTarget = new Map<string, string[]>();
  for (const f of diffFiles) {
    byTarget.set(norm(f.path), []);
  }
  for (const e of edges) {
    const t = norm(e.target);
    const s = norm(e.source);
    if (!s) continue;
    const list = byTarget.get(t);
    if (list) list.push(s);
  }
  for (const [, list] of byTarget) list.sort();
  return byTarget;
}

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

  /**
   * Get PR overview (title, summary, key files with danger, action items).
   * Uses dependency graph inbound links for each file in the diff; sends whatever the graph gives (may be empty).
   * First call starts a background summarizer; poll until building is false.
   */
  getPROverview: publicProcedure
    .input(z.object({ pullNumber: z.number().int().positive() }))
    .query(async ({ ctx, input }): Promise<{ building: boolean; overview?: PROverviewResult; error?: string }> => {
      const key = overviewKey(ctx.projectRoot, input.pullNumber);
      const cached = overviewCache.get(key);
      if (cached) return { building: false, overview: cached };

      const projectId = sessionStore.resolveProjectId(ctx.projectRoot);
      const fileCached = readPROverviewFromCache(projectId, input.pullNumber);
      if (fileCached) {
        overviewCache.set(key, fileCached);
        return { building: false, overview: fileCached };
      }

      if (overviewBuilding.has(key)) return { building: true };

      const prData = await getPRContextAndFiles(ctx.projectRoot, input.pullNumber);
      if (!prData) return { building: false, error: 'Could not load PR (not a GitHub repo or missing token).' };

      const graph = getCachedDependencyGraph(ctx.projectRoot, '.');
      const inboundMap = graph
        ? inboundDepsForDiffFiles(prData.diffFiles, graph.edges)
        : new Map<string, string[]>();
      const inboundSection = prData.diffFiles
        .map((f) => {
          const path = f.path.replace(/\\/g, '/').trim();
          const deps = inboundMap.get(path) ?? [];
          return `${f.path} (${f.status}): ${deps.length} inbound — ${deps.slice(0, 20).join(', ')}${deps.length > 20 ? ' …' : ''}`;
        })
        .join('\n');

      overviewBuilding.add(key);
      const projectIdForBuild = projectId;
      const pullNumberForBuild = input.pullNumber;
      setImmediate(async () => {
        try {
          const { defaultProviderId, providers } = getAllProviders(ctx.projectRoot);
          const providerId = defaultProviderId || providers[0]?.id;
          if (!providerId) {
            overviewBuilding.delete(key);
            overviewCache.set(key, {
              title: 'Overview unavailable',
              summary: 'No LLM provider configured.',
              keyFiles: [],
              actionItems: [],
            });
            return;
          }
          const systemPrompt = `You are a PR overview assistant. Analyze the pull request and respond with a JSON object only (no markdown, no code fence). Keys: "title" (short code-based title, e.g. "Adding Redis cluster support"), "summary" (code-based summary of changes), "keyFiles" (array of { "path", "dangerLevel", "reason" } for important changed files; dangerLevel must be one of: high, medium, low), "actionItems" (array of objects: { "text": string (thing to look for or consider; no judgments), "level": "high" | "medium" | "low", "files": string[] (relevant file paths from the PR, e.g. files mentioned in the diff) }). Use level to indicate importance. Do not make judgments about the PR; only provide an overview and things to look at.`;
          const userContent = `## Pull request context\n\n${prData.contextText}\n\n## Inbound dependencies (files that depend on each changed file)\n${inboundSection}\n\nRespond with a single JSON object.`;
          const res = await chat(
            [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userContent },
            ],
            { providerId, projectRoot: ctx.projectRoot }
          );
          const raw = (res.content ?? '').trim();
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
          const overview: PROverviewResult = parsed
            ? {
                title: String(parsed.title ?? ''),
                summary: String(parsed.summary ?? ''),
                keyFiles: Array.isArray(parsed.keyFiles)
                  ? parsed.keyFiles.map((k: { path?: string; dangerLevel?: string; reason?: string }) => ({
                      path: String(k?.path ?? ''),
                      dangerLevel: String(k?.dangerLevel ?? ''),
                      reason: k?.reason != null ? String(k.reason) : undefined,
                    }))
                  : [],
                actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.map(normalizeActionItem) : [],
              }
            : {
                title: 'Overview',
                summary: raw || 'Could not parse overview.',
                keyFiles: [],
                actionItems: [],
              };
          overviewCache.set(key, overview);
          writePROverviewToCache(projectIdForBuild, pullNumberForBuild, overview);
        } catch (err) {
          console.warn('[getPROverview] summarizer failed', err);
          overviewCache.set(key, {
            title: 'Overview failed',
            summary: err instanceof Error ? err.message : String(err),
            keyFiles: [],
            actionItems: [],
          });
        } finally {
          overviewBuilding.delete(key);
        }
      });
      return { building: true };
    }),

  /** Clear cached PR overview for a pull request so the next getPROverview will regenerate it. */
  invalidatePROverview: publicProcedure
    .input(z.object({ pullNumber: z.number().int().positive() }))
    .mutation(({ ctx, input }) => {
      const key = overviewKey(ctx.projectRoot, input.pullNumber);
      overviewCache.delete(key);
      overviewBuilding.delete(key);
      const projectId = sessionStore.resolveProjectId(ctx.projectRoot);
      deletePROverviewCache(projectId, input.pullNumber);
      return { ok: true };
    }),
});

const PR_STATUS_MAP: Record<string, string> = {
  added: 'A',
  removed: 'D',
  modified: 'M',
  changed: 'M',
  renamed: 'R',
  copied: 'C',
};

/**
 * Fetch PR + files and return context string and list of changed files (path + status).
 * Used by getPRContextForAgent and by PR overview summarizer.
 */
export async function getPRContextAndFiles(
  projectRoot: string,
  pullNumber: number
): Promise<{ contextText: string; diffFiles: Array<{ path: string; status: string }> } | null> {
  if (!projectRoot || !isGitRepository(projectRoot)) return null;
  const url = getRemoteOriginUrl(projectRoot);
  const repo = url ? parseGitHubRepoFromUrl(url) : null;
  if (!repo) return null;
  const token = getGitHubToken();
  if (!token) return null;

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

  const diffFiles: GitDiffFile[] = files.map((f) => {
    const status = (PR_STATUS_MAP[f.status] ?? 'M') as GitDiffFile['status'];
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
  const contextText = parts.filter(Boolean).join('\n').trim();
  return {
    contextText,
    diffFiles: diffFiles.map((f) => ({ path: f.path.replace(/\\/g, '/').trim(), status: f.status })),
  };
}

/**
 * Fetch PR title, body, and diff and return a single string for agent context.
 * Used when the user is chatting about a PR so the agent has the full PR in context.
 */
export async function getPRContextForAgent(
  projectRoot: string,
  pullNumber: number
): Promise<string> {
  const result = await getPRContextAndFiles(projectRoot, pullNumber);
  return result?.contextText ?? '';
}
