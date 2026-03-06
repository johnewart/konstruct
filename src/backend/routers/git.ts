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
import { isGitAvailable } from '../git';
import type { GitDiffFile, GitFileChange } from '../git';
import { getGlobalConfigDir, getProjectModel } from '../../shared/config';
import * as sessionStore from '../../shared/sessionStore';
// import { getCachedDependencyGraph } from './codebase';
import { chat } from '../../shared/llm';
import { getAllProviders } from '../../shared/providers';
import * as runProgressStore from '../../agent/runProgressStore';

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
  /** Untracked files (??); suggestTrack true if the agent thinks this file should be tracked. */
  filesUntracked?: Array<{ path: string; description: string; suggestTrack?: boolean }>;
}

const DIFF_OVERVIEW_CACHE_FILE = 'diff-overview.json';

/** Find the end of the top-level JSON object starting at start (the index of '{'). */
function findJsonObjectEnd(raw: string, start: number): number {
  let depth = 0;
  let inString: '"' | "'" | null = null;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\' && inString) {
      escape = true;
      continue;
    }
    if (inString) {
      if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}
const diffOverviewCache = new Map<string, DiffOverviewResult>();
const diffOverviewBuilding = new Set<string>();

function diffOverviewKey(workspaceId: string): string {
  return workspaceId;
}

/** Normalize path for staged-vs-unstaged comparison (slash, trim, no leading ./). */
function normalizePathForStagedComparison(p: string): string {
  return p.replace(/\\/g, '/').trim().replace(/^\.\/+/, '');
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

function normalizeFilesUntracked(raw: unknown): DiffOverviewResult['filesUntracked'] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => item != null && typeof item === 'object' && typeof (item as { path?: unknown }).path === 'string')
    .map((item) => {
      const o = item as { path: string; description?: string; suggestTrack?: boolean };
      return {
        path: String(o.path),
        description: typeof o.description === 'string' ? o.description : '',
        suggestTrack: o.suggestTrack === true,
      };
    });
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
    let filesUntracked = normalizeFilesUntracked(data.filesUntracked);
    if (filesUntracked.length === 0 && Array.isArray(data.filesNotStaged)) {
      const legacy = (data.filesNotStaged as Array<{ path?: string; description?: string; potentiallyMissingFromStaged?: boolean }>).map((o) => ({
        path: String(o?.path ?? ''),
        description: typeof o?.description === 'string' ? o.description : '',
        suggestTrack: o?.potentiallyMissingFromStaged === true,
      }));
      filesUntracked = legacy;
    }
    const confidence = normalizeConfidence(data.confidence);
    return {
      title: (data.title as string) ?? '',
      summary: (data.summary as string) ?? '',
      review: (data.review as string) ?? '',
      confidence,
      keyFiles,
      actionItems,
      filesUntracked,
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

  getChangedFiles: publicProcedure.query(async ({ ctx }) => {
    const conn = await ctx.workspace.getOrSpawnAgent();
    const out = await conn.executeTool('getChangedFiles', {});
    if (out.error) return [] as const;
    let changes: GitFileChange[] = [];
    try {
      changes = JSON.parse(out.result ?? '[]') as GitFileChange[];
    } catch {
      return [] as const;
    }
    if (changes.length === 0) return [] as const;
    const statsOut = await conn.executeTool('getComprehensiveDiffStats', {});
    let stats = new Map<string, { added: number; removed: number }>();
    if (!statsOut.error && statsOut.result) {
      try {
        const obj = JSON.parse(statsOut.result) as Record<string, { added: number; removed: number }>;
        stats = new Map(Object.entries(obj));
      } catch {
        // ignore
      }
    }
    return changes.map((change) => {
      const fileStats = stats.get(change.path) || { added: 0, removed: 0 };
      return { ...change, added: fileStats.added, removed: fileStats.removed };
    });
  }),

  getGitDiff: publicProcedure.query(async ({ ctx }) => {
    const conn = await ctx.workspace.getOrSpawnAgent();
    const out = await conn.executeTool('getGitDiff', {});
    if (out.error) return [];
    try {
      return JSON.parse(out.result ?? '[]') as GitDiffFile[];
    } catch {
      return [];
    }
  }),

  /**
   * Get overview of local diff (title, summary, key files, action items).
   * Runs once when there is no cached result; afterwards only when user triggers via invalidate + refetch.
   * Unparseable cache is treated as cache miss (re-run).
   * Optional input.providerId and input.model use the project-scoped selection when provided by the frontend.
   */
  getDiffOverview: publicProcedure
    .input(
      z
        .object({
          providerId: z.string().optional(),
          model: z.string().optional(),
        })
        .optional()
    )
    .query(
      async ({
        ctx,
        input,
      }): Promise<{ building: boolean; overview?: DiffOverviewResult; error?: string; progressId?: string }> => {
        const key = diffOverviewKey(ctx.workspace.id);
        const cached = diffOverviewCache.get(key);
        if (cached) return { building: false, overview: cached };

        const projectId = ctx.workspace.id;
        const fileCached = readDiffOverviewFromCache(projectId);
        if (fileCached) {
          diffOverviewCache.set(key, fileCached);
          return { building: false, overview: fileCached };
        }

        const conn = await ctx.workspace.getOrSpawnAgent();
        const out = await conn.executeTool('getGitDiff', {});
        if (out.error) return { building: false, error: out.error };
        let diffFiles: GitDiffFile[] = [];
        try {
          diffFiles = JSON.parse(out.result ?? '[]') as GitDiffFile[];
        } catch {
          return { building: false, error: 'Failed to parse getGitDiff result' };
        }
        if (diffFiles.length === 0) return { building: false, error: 'No local changes.' };

        const progressId = `diff-overview:${projectId}`;
        if (diffOverviewBuilding.has(key)) return { building: true, progressId };
        diffOverviewBuilding.add(key);

        const graph = undefined;
        const diffFileList = diffFiles.map((f) => ({ path: f.path.replace(/\\/g, '/').trim(), status: f.status }));
        const pathsUntracked = diffFileList.filter((f) => f.status === '??').map((f) => f.path);
        const trackedSet = new Set(
          diffFileList.filter((f) => f.status !== '??').map((f) => normalizePathForStagedComparison(f.path))
        );
        const trackedList = diffFileList.filter((f) => f.status !== '??').map((f) => f.path);
        const inboundMap = graph ? inboundDepsForDiffFiles(diffFileList, graph.edges) : new Map<string, string[]>();
        const inboundSection = diffFileList
          .map((f) => {
            const deps = inboundMap.get(f.path) ?? [];
            return `${f.path} (${f.status}): ${deps.length} inbound — ${deps.slice(0, 20).join(', ')}${deps.length > 20 ? ' …' : ''}`;
          })
          .join('\n');

        const contextText = buildDiffContextText(diffFiles);

        const storedProjectModel = projectId ? getProjectModel(projectId) : undefined;
        const providerIdInput = input?.providerId ?? storedProjectModel?.providerId;
        const modelInput = input?.model ?? storedProjectModel?.modelId;

        setImmediate(async () => {
          runProgressStore.setRunning(progressId, true);
          runProgressStore.pushProgress(progressId, {
            type: 'status',
            description: 'Analyzing your changes…',
            pending: true,
          });
          try {
            const { defaultProviderId, providers } = getAllProviders(ctx.workspace.getLocalPath() ?? '');
            const providerId = providerIdInput ?? defaultProviderId ?? providers[0]?.id;
            if (!providerId) {
              runProgressStore.clearProgress(progressId);
              runProgressStore.setRunning(progressId, false);
              diffOverviewBuilding.delete(key);
              diffOverviewCache.set(key, {
                title: 'Overview unavailable',
                summary: 'No LLM provider configured.',
                review: '',
                confidence: DEFAULT_CONFIDENCE,
                keyFiles: [],
                actionItems: [],
                filesUntracked: [],
              });
              return;
            }
          const systemPrompt = `You are a diff overview and code review assistant.

Consider only TRACKED files (staged or unstaged) for the overall review, confidence score, and "keyFiles" list. Ignore untracked files (??) for the main analysis—do not put untracked paths in keyFiles. For untracked files: list them in "filesUntracked" with a short description; set "suggestTrack" to true only for files that seem important and should likely be tracked (e.g. source code, config that belongs in the repo). If you believe important files are untracked and should be tracked, reduce the quality score and state in the quality "explanation" and "evidence" that you think files are untracked that should be tracked.

Provide a running commentary as you analyze. The user sees this commentary in real time under an "Analyzing" spinner, so emit many short updates as you go—for example: which files or sections you're looking at first, what you're considering next (risk areas, patterns, tests), key observations, and so on. Write in plain language. The more frequent and concrete your updates, the better; the user is waiting and wants to see progress. After your commentary, output the final result as a single JSON object only (no markdown, no code fence). The JSON must have these keys:
- "title" (short code-based title)
- "summary" (1–2 sentence code-based summary of changes; focus on tracked changes)
- "review" (a detailed analytical code review: 2–4 paragraphs covering what changed, design/architecture impact, potential risks, and notable patterns or improvements; focus on tracked files; use clear paragraphs and be specific about files and behavior)
- "confidence" (object with three dimensions; each dimension must have "score" (0–100), "explanation" (why this score in 1–3 sentences), and "evidence" (specific references from the diff: file paths, line numbers, or code snippets that support the score)); base scores only on TRACKED files. For "quality": reduce the score and mention in explanation/evidence if you think important files are untracked and should be tracked:
  - "quality": code quality, maintainability, clarity, patterns; lower score if important files appear untracked
  - "testCoverage": presence and adequacy of tests in or affected by the diff; use 0 if no test changes
  - "security": security implications (input handling, auth, sensitive data, dependencies)
- "keyFiles" (array of { "path", "dangerLevel", "reason" }; dangerLevel one of: high, medium, low). Include ONLY paths that are TRACKED (staged or unstaged). Do not list untracked (??) files here.
- "actionItems" (array of { "text", "level": "high"|"medium"|"low", "files": string[] })
- "filesUntracked" (array of { "path", "description", "suggestTrack" }). List every untracked file (??) from the diff. For each: "path" (file path), "description" (short note, e.g. "Generated artifact", "Local dump"), and "suggestTrack" (true only if you think this file should likely be tracked; false for build artifacts, dumps, local config, etc.).

Provide the analytical "review", the "confidence" breakdown with evidence for each dimension, the structured keyFiles/actionItems, and filesUntracked.`;
          const trackedListStr = trackedList.length > 0 ? trackedList.join('\n') : '(none)';
          const untrackedList = pathsUntracked.length > 0 ? pathsUntracked.join('\n') : '(none)';
          const userContent = `## Tracked files (staged or unstaged) – use ONLY these for keyFiles and overall score\nThese are the ONLY paths allowed in "keyFiles". Every path in keyFiles must be exactly one of these.\n${trackedListStr}\n\n## Untracked files (??) – do NOT put these in keyFiles\nList these only in "filesUntracked". Set "suggestTrack" to true for any that seem important and should be tracked.\n${untrackedList}\n\n## Local diff (tracked + untracked)\n\n${contextText}\n\n## Inbound dependencies (files that depend on each changed file)\n${inboundSection}\n\nEmit a running commentary as you analyze (many short updates: what you're looking at, considering, noticing). Then output the single JSON object with the required keys. In keyFiles include ONLY paths from the tracked list above. In filesUntracked list every path from the untracked list above; set suggestTrack for any that should be tracked. If important files are untracked, reduce the quality score and say so in the quality explanation and evidence.`;
          const res = await chat(
            [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userContent },
            ],
            {
              providerId,
              model: modelInput,
              projectRoot: ctx.workspace.getLocalPath() ?? '',
              sessionId: progressId,
              progressStore: runProgressStore,
            }
          );
          const raw = (res.content ?? '').trim();
          let parsed: Record<string, unknown> | null = null;
          const re = /\{\s*["']title["']\s*:/g;
          let lastStart = -1;
          let m: RegExpExecArray | null = null;
          while ((m = re.exec(raw)) !== null) lastStart = m.index;
          if (lastStart >= 0) {
            const end = findJsonObjectEnd(raw, lastStart);
            const jsonSlice = end >= 0 ? raw.slice(lastStart, end) : raw.slice(lastStart);
            try {
              const obj = JSON.parse(jsonSlice) as Record<string, unknown>;
              if (obj && typeof obj === 'object' && 'title' in obj) parsed = obj;
            } catch {
              // parse failed (e.g. truncated or trailing content); fall through to scan
            }
          }
          if (parsed === null) {
            for (let i = 0; i < raw.length; i++) {
              if (raw[i] === '{') {
                const end = findJsonObjectEnd(raw, i);
                const jsonSlice = end >= 0 ? raw.slice(i, end) : raw.slice(i);
                try {
                  const obj = JSON.parse(jsonSlice) as Record<string, unknown>;
                  if (obj && typeof obj === 'object' && 'title' in obj) parsed = obj;
                } catch {
                  // ignore
                }
              }
            }
          }
          const rawKeyFiles = Array.isArray(parsed.keyFiles)
            ? parsed.keyFiles.map((k: { path?: string; dangerLevel?: string; reason?: string }) => ({
                path: String(k?.path ?? '').replace(/\\/g, '/').trim(),
                dangerLevel: String(k?.dangerLevel ?? ''),
                reason: k?.reason != null ? String(k.reason) : undefined,
              }))
            : [];
          const keyFilesTrackedOnly = rawKeyFiles.filter((k) =>
            trackedSet.has(normalizePathForStagedComparison(k.path))
          );
          const overview: DiffOverviewResult = parsed
            ? {
                title: String(parsed.title ?? ''),
                summary: String(parsed.summary ?? ''),
                review: String(parsed.review ?? ''),
                confidence: normalizeConfidence(parsed.confidence),
                keyFiles: keyFilesTrackedOnly,
                actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.map(normalizeDiffActionItem) : [],
                filesUntracked: normalizeFilesUntracked(parsed.filesUntracked),
              }
            : {
                title: 'Overview',
                summary: raw || 'Could not parse overview.',
                review: '',
                confidence: DEFAULT_CONFIDENCE,
                keyFiles: [],
                actionItems: [],
                filesUntracked: [],
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
            filesUntracked: [],
          });
        } finally {
          runProgressStore.clearProgress(progressId);
          runProgressStore.setRunning(progressId, false);
          diffOverviewBuilding.delete(key);
        }
      });
      return { building: true, progressId };
    }
  ),

  /** Clear cached diff overview so the next getDiffOverview will run the reviewer again (e.g. when user clicks "Analyze"). */
  invalidateDiffOverview: publicProcedure.mutation(({ ctx }) => {
    const key = diffOverviewKey(ctx.workspace.id);
    diffOverviewCache.delete(key);
    diffOverviewBuilding.delete(key);
    const projectId = ctx.workspace.id;
    runProgressStore.clearProgress(`diff-overview:${projectId}`);
    deleteDiffOverviewCache(projectId);
    return { ok: true };
  }),
});
