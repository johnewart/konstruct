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
import { getChangedFiles, getComprehensiveDiffStats, isGitAvailable, getGitDiff } from '../git';
import type { GitDiffFile } from '../git';
import { getGlobalConfigDir } from '../../shared/config';
import * as sessionStore from '../../shared/sessionStore';
import { getCachedDependencyGraph } from './codebase';
import { chat } from '../../shared/llm';
import { getAllProviders } from '../../shared/providers';

/** Confidence dimension: score 0–100 with explanation and evidence from the diff. */
export interface ConfidenceDimension {
  score: number;
  explanation: string;
  evidence: string;
}

/** Same shape as PR overview for local diff summary, plus analytical review and confidence breakdown. */
export interface DiffOverviewResult {
  title: string;
  summary: string;
  /** Highly analytical code review of the changes (multiple paragraphs). */
  review: string;
  /** Confidence breakdown: quality, test coverage, security. Each has score (0–100), explanation, and evidence. */
  confidence: {
    quality: ConfidenceDimension;
    testCoverage: ConfidenceDimension;
    security: ConfidenceDimension;
  };
  keyFiles: Array<{ path: string; dangerLevel: string; reason?: string }>;
  actionItems: Array<{ text: string; level: 'high' | 'medium' | 'low'; files?: string[] }>;
}

const DIFF_OVERVIEW_CACHE_FILE = 'diff-overview.json';
const diffOverviewCache = new Map<string, DiffOverviewResult>();
const diffOverviewBuilding = new Set<string>();

function diffOverviewKey(projectRoot: string): string {
  return projectRoot;
}

function getDiffOverviewCachePath(projectId: string): string {
  return path.join(getGlobalConfigDir(), 'projects', projectId, 'cache', DIFF_OVERVIEW_CACHE_FILE);
}

function normalizeDiffActionItem(raw: unknown): DiffOverviewResult['actionItems'][0] {
  if (raw && typeof raw === 'object' && 'text' in raw && typeof (raw as { text: unknown }).text === 'string') {
    const o = raw as { text: string; level?: string; files?: unknown };
    const level = o.level === 'high' || o.level === 'medium' || o.level === 'low' ? o.level : 'medium';
    const files = Array.isArray(o.files) ? o.files.filter((f): f is string => typeof f === 'string') : [];
    return { text: o.text, level, files };
  }
  if (typeof raw === 'string') return { text: raw, level: 'medium', files: [] };
  return { text: String(raw), level: 'medium', files: [] };
}

function readDiffOverviewFromCache(projectId: string): DiffOverviewResult | null {
  try {
    const filePath = getDiffOverviewCachePath(projectId);
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
    const actionItems = Array.isArray(data.actionItems) ? data.actionItems.map(normalizeDiffActionItem) : [];
    const confidence = normalizeConfidence(data.confidence);
    return {
      title: (data.title as string) ?? '',
      summary: (data.summary as string) ?? '',
      review: (data.review as string) ?? '',
      confidence,
      keyFiles,
      actionItems,
    };
  } catch {
    return null;
  }
}

const DEFAULT_CONFIDENCE: DiffOverviewResult['confidence'] = {
  quality: { score: 0, explanation: '', evidence: '' },
  testCoverage: { score: 0, explanation: '', evidence: '' },
  security: { score: 0, explanation: '', evidence: '' },
};

function normalizeDimension(raw: unknown): ConfidenceDimension {
  if (raw && typeof raw === 'object' && 'score' in raw) {
    const o = raw as { score?: unknown; explanation?: unknown; evidence?: unknown };
    const score = typeof o.score === 'number' ? Math.min(100, Math.max(0, o.score)) : 0;
    return {
      score,
      explanation: typeof o.explanation === 'string' ? o.explanation : '',
      evidence: typeof o.evidence === 'string' ? o.evidence : '',
    };
  }
  return { score: 0, explanation: '', evidence: '' };
}

function normalizeConfidence(raw: unknown): DiffOverviewResult['confidence'] {
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    return {
      quality: normalizeDimension(o.quality),
      testCoverage: normalizeDimension(o.testCoverage),
      security: normalizeDimension(o.security),
    };
  }
  return DEFAULT_CONFIDENCE;
}

function writeDiffOverviewToCache(projectId: string, overview: DiffOverviewResult): void {
  try {
    const filePath = getDiffOverviewCachePath(projectId);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(overview, null, 0), 'utf-8');
  } catch (err) {
    console.warn('[diff overview] failed to write cache', err);
  }
}

function deleteDiffOverviewCache(projectId: string): void {
  try {
    const filePath = getDiffOverviewCachePath(projectId);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

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

function buildDiffContextText(diffFiles: GitDiffFile[]): string {
  const statusMap: Record<string, string> = { M: 'M', A: 'A', D: 'D', R: 'R', C: 'C', '??': 'A' };
  const parts = diffFiles.map((file) => {
    const status = statusMap[file.status] ?? 'M';
    const hunksText = file.hunks
      .map((hunk) => {
        const lineStr = hunk.lines
          .map((l) => (l.type === 'add' ? '+' : l.type === 'remove' ? '-' : ' ') + l.content)
          .join('\n');
        return hunk.header + '\n' + lineStr;
      })
      .join('\n');
    return `### ${file.path} (${status})\n${hunksText}`;
  });
  return `# Local changes (working tree)\n\n${parts.join('\n\n')}`;
}

export const gitRouter = router({
  isAvailable: publicProcedure.query(() => isGitAvailable()),

  getChangedFiles: publicProcedure.query(({ ctx }) => {
    const changes = getChangedFiles(ctx.projectRoot);

    if (changes.length === 0) {
      return [] as const;
    }

    // Get comprehensive diff stats for all changed files
    const stats = getComprehensiveDiffStats(ctx.projectRoot);

    return changes.map((change) => {
      const fileStats = stats.get(change.path) || { added: 0, removed: 0 };
      return {
        ...change,
        added: fileStats.added,
        removed: fileStats.removed,
      };
    });
  }),

  getGitDiff: publicProcedure.query(({ ctx }) => {
    return getGitDiff(ctx.projectRoot);
  }),

  /**
   * Get overview of local diff (title, summary, key files, action items).
   * Runs once when there is no cached result; afterwards only when user triggers via invalidate + refetch.
   * Unparseable cache is treated as cache miss (re-run).
   */
  getDiffOverview: publicProcedure.query(
    async ({ ctx }): Promise<{ building: boolean; overview?: DiffOverviewResult; error?: string }> => {
      const key = diffOverviewKey(ctx.projectRoot);
      const cached = diffOverviewCache.get(key);
      if (cached) return { building: false, overview: cached };

      const projectId = sessionStore.resolveProjectId(ctx.projectRoot);
      const fileCached = readDiffOverviewFromCache(projectId);
      if (fileCached) {
        diffOverviewCache.set(key, fileCached);
        return { building: false, overview: fileCached };
      }

      const diffFiles = getGitDiff(ctx.projectRoot);
      if (diffFiles.length === 0) return { building: false, error: 'No local changes.' };

      if (diffOverviewBuilding.has(key)) return { building: true };

      const graph = getCachedDependencyGraph(ctx.projectRoot, '.');
      const diffFileList = diffFiles.map((f) => ({ path: f.path.replace(/\\/g, '/').trim(), status: f.status }));
      const inboundMap = graph ? inboundDepsForDiffFiles(diffFileList, graph.edges) : new Map<string, string[]>();
      const inboundSection = diffFileList
        .map((f) => {
          const deps = inboundMap.get(f.path) ?? [];
          return `${f.path} (${f.status}): ${deps.length} inbound — ${deps.slice(0, 20).join(', ')}${deps.length > 20 ? ' …' : ''}`;
        })
        .join('\n');

      const contextText = buildDiffContextText(diffFiles);

      diffOverviewBuilding.add(key);
      setImmediate(async () => {
        try {
          const { defaultProviderId, providers } = getAllProviders(ctx.projectRoot);
          const providerId = defaultProviderId || providers[0]?.id;
          if (!providerId) {
            diffOverviewBuilding.delete(key);
            diffOverviewCache.set(key, {
              title: 'Overview unavailable',
              summary: 'No LLM provider configured.',
              review: '',
              confidence: DEFAULT_CONFIDENCE,
              keyFiles: [],
              actionItems: [],
            });
            return;
          }
          const systemPrompt = `You are a diff overview and code review assistant. Analyze the local (working tree) changes and respond with a JSON object only (no markdown, no code fence). Keys:
- "title" (short code-based title)
- "summary" (1–2 sentence code-based summary of changes)
- "review" (a detailed analytical code review: 2–4 paragraphs covering what changed, design/architecture impact, potential risks, and notable patterns or improvements; use clear paragraphs and be specific about files and behavior)
- "confidence" (object with three dimensions; each dimension must have "score" (0–100), "explanation" (why this score in 1–3 sentences), and "evidence" (specific references from the diff: file paths, line numbers, or code snippets that support the score)):
  - "quality": code quality, maintainability, clarity, patterns
  - "testCoverage": presence and adequacy of tests in or affected by the diff; use 0 if no test changes
  - "security": security implications (input handling, auth, sensitive data, dependencies)
- "keyFiles" (array of { "path", "dangerLevel", "reason" }; dangerLevel one of: high, medium, low)
- "actionItems" (array of { "text", "level": "high"|"medium"|"low", "files": string[] })

Provide the analytical "review", the "confidence" breakdown with evidence for each dimension, and the structured keyFiles/actionItems.`;
          const userContent = `## Local diff\n\n${contextText}\n\n## Inbound dependencies (files that depend on each changed file)\n${inboundSection}\n\nRespond with a single JSON object.`;
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
          const overview: DiffOverviewResult = parsed
            ? {
                title: String(parsed.title ?? ''),
                summary: String(parsed.summary ?? ''),
                review: String(parsed.review ?? ''),
                confidence: normalizeConfidence(parsed.confidence),
                keyFiles: Array.isArray(parsed.keyFiles)
                  ? parsed.keyFiles.map((k: { path?: string; dangerLevel?: string; reason?: string }) => ({
                      path: String(k?.path ?? ''),
                      dangerLevel: String(k?.dangerLevel ?? ''),
                      reason: k?.reason != null ? String(k.reason) : undefined,
                    }))
                  : [],
                actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.map(normalizeDiffActionItem) : [],
              }
            : {
                title: 'Overview',
                summary: raw || 'Could not parse overview.',
                review: '',
                confidence: DEFAULT_CONFIDENCE,
                keyFiles: [],
                actionItems: [],
              };
          diffOverviewCache.set(key, overview);
          writeDiffOverviewToCache(projectId, overview);
        } catch (err) {
          console.warn('[getDiffOverview] failed', err);
          diffOverviewCache.set(key, {
            title: 'Overview failed',
            summary: err instanceof Error ? err.message : String(err),
            review: '',
            confidence: DEFAULT_CONFIDENCE,
            keyFiles: [],
            actionItems: [],
          });
        } finally {
          diffOverviewBuilding.delete(key);
        }
      });
      return { building: true };
    }
  ),

  /** Clear cached diff overview so the next getDiffOverview will run the reviewer again (e.g. when user clicks "Analyze"). */
  invalidateDiffOverview: publicProcedure.mutation(({ ctx }) => {
    const key = diffOverviewKey(ctx.projectRoot);
    diffOverviewCache.delete(key);
    diffOverviewBuilding.delete(key);
    const projectId = sessionStore.resolveProjectId(ctx.projectRoot);
    deleteDiffOverviewCache(projectId);
    return { ok: true };
  }),
});
