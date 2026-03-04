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
import { execSync } from 'child_process';
import { resolvePath, getProjectRoot, registerTool } from './executor';
import * as documentStore from '../../shared/documentStore';
import * as sessionStore from '../../shared/sessionStore';
import * as codebaseOutline from '../../shared/codebaseOutline';
import type { ToolContext, ToolResult } from './executor';

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** Max list_files + glob entries to avoid huge payloads. */
const MAX_LIST_ENTRIES = 500;

/** Max lines for read_file_region; avoids pulling in huge files. */
const MAX_READ_FILE_LINES = 400;
/** Max bytes for read_file_region output (~32KB). */
const MAX_READ_FILE_BYTES = 32 * 1024;

/** Grep/search caps to avoid blowing context (align with Go). */
const MAX_GREP_LINES = 200;
const MAX_GREP_BYTES = 32 * 1024;
const MAX_GREP_LINE_CHARS = 200;
const MAX_SEARCH_MATCHES = 500;
const MAX_SEARCH_LINE_CHARS = 250;
const MAX_SEARCH_BYTES = 32 * 1024;

/** Max chars for run_command result (stdout+stderr) in the JSON. */
const MAX_RUN_COMMAND_OUTPUT = 24 * 1024;

function truncateWithNote(s: string, maxBytes: number, note: string): string {
  const b = Buffer.from(s, 'utf-8');
  if (b.length <= maxBytes) return s;
  let slice = b.slice(0, maxBytes);
  while (slice.length > 0 && (slice[slice.length - 1] & 0xc0) === 0x80) {
    slice = slice.slice(0, -1);
  }
  return slice.toString('utf-8') + '\n\n' + note;
}

registerTool('list_files', (args, context): ToolResult => {
  const pathArg = str(args.path);
  if (!pathArg) return { error: 'missing path argument' };
  const resolved = resolvePath(pathArg, context);
  if ('error' in resolved) return { error: resolved.error };
  const glob = str(args.glob);
  try {
    const entries = fs.readdirSync(resolved.fullPath, { withFileTypes: true });
    const files: string[] = [];
    const dirs: string[] = [];
    for (const e of entries) {
      if (dirs.length + files.length >= MAX_LIST_ENTRIES) break;
      if (e.isDirectory()) dirs.push(e.name + '/');
      else {
        if (!glob || matchGlob(glob, e.name)) files.push(e.name);
      }
    }
    const truncated = dirs.length + files.length >= MAX_LIST_ENTRIES;
    const out: Record<string, unknown> = { directory: pathArg, files, dirs };
    if (truncated)
      (out as Record<string, unknown>).truncated =
        `max ${MAX_LIST_ENTRIES} entries; use glob or a path to narrow`;
    return {
      result: JSON.stringify(out, null, 2),
    };
  } catch (err) {
    return { error: `failed to read directory: ${err}` };
  }
});

function matchGlob(glob: string, name: string): boolean {
  try {
    const parts = glob
      .split('*')
      .map((p) => p.replace(/[.+^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp('^' + parts.join('.*') + '$');
    return re.test(name);
  } catch {
    return false;
  }
}

registerTool('glob', (args, context): ToolResult => {
  const pattern = str(args.pattern);
  if (!pattern) return { error: 'missing pattern argument' };
  const pathArg = str(args.path) ?? '.';
  const resolved = resolvePath(pathArg, context);
  if ('error' in resolved) return { error: resolved.error };
  const matched: string[] = [];
  try {
    walkSync(resolved.fullPath, (p) => {
      if (matched.length >= MAX_LIST_ENTRIES) return;
      let rel = path.relative(getProjectRoot(context), p);
      if (path.sep !== '/') rel = rel.split(path.sep).join('/');
      const base = path.basename(p);
      if (matchGlob(pattern, base)) matched.push(rel);
    });
    const truncated = matched.length >= MAX_LIST_ENTRIES;
    const out: Record<string, unknown> = {
      pattern,
      path: pathArg,
      files: matched,
    };
    if (truncated)
      (out as Record<string, unknown>).truncated =
        `max ${MAX_LIST_ENTRIES} paths; narrow pattern or path`;
    return {
      result: JSON.stringify(out, null, 2),
    };
  } catch (err) {
    return { error: `walk failed: ${err}` };
  }
});

function walkSync(dir: string, onFile: (p: string) => void) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith('.')) walkSync(full, onFile);
    } else {
      onFile(full);
    }
  }
}

registerTool('read_file_region', (args, context): ToolResult => {
  const pathArg = str(args.path);
  const startLine = num(args.start_line);
  const endLine = num(args.end_line);
  if (!pathArg) return { error: 'missing path argument' };
  if (startLine == null) return { error: 'missing or invalid start_line' };
  if (endLine == null) return { error: 'missing or invalid end_line' };
  const resolved = resolvePath(pathArg, context);
  if ('error' in resolved) return { error: resolved.error };
  try {
    const stat = fs.statSync(resolved.fullPath);
    if (!stat.isFile()) return { error: 'path is not a file' };
    if (stat.size > 2 * 1024 * 1024) {
      return {
        error: `file is very large (${Math.round(stat.size / 1024)}KB). Use read_file_region with a narrow line range (max ${MAX_READ_FILE_LINES} lines).`,
      };
    }
    const content = fs.readFileSync(resolved.fullPath, 'utf-8');
    const lines = content.split('\n');
    let s = Math.max(1, startLine);
    let e = Math.min(lines.length, endLine);
    if (s > e) return { error: `start_line (${s}) must be <= end_line (${e})` };
    const requested = e - s + 1;
    if (requested > MAX_READ_FILE_LINES) {
      e = s + MAX_READ_FILE_LINES - 1;
    }
    const slice = lines.slice(s - 1, e);
    let result = slice.join('\n');
    if (Buffer.byteLength(result, 'utf-8') > MAX_READ_FILE_BYTES) {
      result = truncateWithNote(
        result,
        MAX_READ_FILE_BYTES,
        `(truncated; output exceeds ${MAX_READ_FILE_BYTES / 1024}KB for this range. Request a smaller range.)`
      );
    }
    return { result };
  } catch (err) {
    return { error: `failed to read file: ${err}` };
  }
});

registerTool('grep', (args, context): ToolResult => {
  const pattern = str(args.pattern);
  if (!pattern) return { error: 'missing pattern argument' };
  const pathArg = str(args.path) ?? '.';
  const contextLines = num(args.context) ?? 0;
  const resolved = resolvePath(pathArg, context);
  if ('error' in resolved) return { error: resolved.error };
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch (err) {
    return { error: `invalid regex: ${err}` };
  }
  const results: string[] = [];
  const fullPath = resolved.fullPath;
  const root = getProjectRoot(context);
  const searchInFile = (filePath: string, rel: string) => {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length && results.length < MAX_GREP_LINES; i++) {
      if (!re.test(lines[i])) continue;
      const start = Math.max(0, i - contextLines);
      const end = Math.min(lines.length, i + contextLines + 1);
      for (let j = start; j < end && results.length < MAX_GREP_LINES; j++) {
        const prefix = j === i ? '> ' : '  ';
        let line = lines[j];
        if (line.length > MAX_GREP_LINE_CHARS)
          line = line.slice(0, MAX_GREP_LINE_CHARS) + '...(truncated)';
        results.push(`${rel}:${j + 1}:${prefix}${line}`);
      }
      results.push('');
    }
  };
  try {
    const stat = fs.statSync(fullPath);
    if (stat.isFile()) {
      searchInFile(fullPath, path.relative(root, fullPath));
    } else {
      walkSync(fullPath, (p) => {
        if (results.length >= MAX_GREP_LINES) return;
        searchInFile(p, path.relative(root, p));
      });
    }
  } catch (err) {
    return { error: `grep failed: ${err}` };
  }
  let out = results.join('\n').trimEnd();
  if (Buffer.byteLength(out, 'utf-8') > MAX_GREP_BYTES) {
    out = truncateWithNote(
      out,
      MAX_GREP_BYTES,
      `(truncated: output exceeded ${MAX_GREP_BYTES / 1024}KB. Use read_file_region on specific files/lines.)`
    );
  }
  if (results.length >= MAX_GREP_LINES && out !== '(no matches)') {
    out += `\n\n(truncated: max ${MAX_GREP_LINES} result lines. Use read_file_region on specific files/lines.)`;
  }
  return { result: out || '(no matches)' };
});

registerTool('search_code', (args, context): ToolResult => {
  const pattern = str(args.pattern);
  const pathArg = str(args.path) ?? '.';
  if (!pattern) return { error: 'missing pattern argument' };
  const resolved = resolvePath(pathArg, context);
  if ('error' in resolved) return { error: resolved.error };
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch (err) {
    return { error: `invalid regex: ${err}` };
  }
  const results: string[] = [];
  const fullPath = resolved.fullPath;
  const root = getProjectRoot(context);
  const searchInFile = (filePath: string, rel: string) => {
    if (results.length >= MAX_SEARCH_MATCHES) return;
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    for (
      let i = 0;
      i < lines.length && results.length < MAX_SEARCH_MATCHES;
      i++
    ) {
      if (re.test(lines[i])) {
        let line = lines[i].trim();
        if (line.length > MAX_SEARCH_LINE_CHARS)
          line = line.slice(0, MAX_SEARCH_LINE_CHARS) + '...';
        results.push(`${rel}:${i + 1}: ${line}`);
      }
    }
  };
  try {
    const stat = fs.statSync(fullPath);
    if (stat.isFile()) searchInFile(fullPath, path.relative(root, fullPath));
    else walkSync(fullPath, (p) => searchInFile(p, path.relative(root, p)));
  } catch (err) {
    return { error: `search failed: ${err}` };
  }
  let out = results.length ? results.join('\n') : '(no matches)';
  if (Buffer.byteLength(out, 'utf-8') > MAX_SEARCH_BYTES) {
    out = truncateWithNote(
      out,
      MAX_SEARCH_BYTES,
      `(truncated: max ${MAX_SEARCH_BYTES / 1024}KB. Narrow pattern or path.)`
    );
  }
  if (results.length >= MAX_SEARCH_MATCHES && out !== '(no matches)') {
    out += `\n\n(truncated: max ${MAX_SEARCH_MATCHES} matches. Narrow pattern or path.)`;
  }
  return { result: out };
});

registerTool('codebase_outline', (args, context): ToolResult => {
  const pathArg = str(args.path);
  if (!pathArg) return { error: 'missing path argument' };
  const glob = str(args.glob);
  const root = getProjectRoot(context);
  const resolved = resolvePath(pathArg, context);
  if ('error' in resolved) return { error: resolved.error };
  try {
    const { outline, truncated } = codebaseOutline.outlinePath(
      root,
      pathArg,
      glob ?? undefined
    );
    const result = truncated
      ? outline + '\n\n(truncated; narrow path or glob to see more)'
      : outline;
    return { result };
  } catch (err) {
    const loadErr = codebaseOutline.getOutlineLoadError();
    if (loadErr) {
      return {
        error:
          'Tree-sitter could not be loaded (native module missing). Use list_files and read_file_region to explore. To enable: run the server with Node, or run `npm rebuild tree-sitter tree-sitter-javascript tree-sitter-python tree-sitter-typescript` and restart.',
      };
    }
    return { error: `codebase_outline failed: ${err}` };
  }
});

registerTool('edit_file', (args, context): ToolResult => {
  const pathArg = str(args.path);
  const oldStr = str(args.old_string);
  const newStr = str(args.new_string);
  if (!pathArg) return { error: 'missing path argument' };
  if (!oldStr) return { error: 'missing old_string argument' };
  if (newStr === undefined) return { error: 'missing new_string argument' };
  const resolved = resolvePath(pathArg, context);
  if ('error' in resolved) return { error: resolved.error };
  try {
    const content = fs.readFileSync(resolved.fullPath, 'utf-8');
    const count = content.split(oldStr).length - 1;
    if (count === 0) {
      return {
        error:
          'old_string not found. Use read_file_region to get exact content, then use that as old_string.',
        retryable: true,
      };
    }
    if (count > 1) {
      return {
        error: `old_string appears ${count} times; use a larger unique section from read_file_region.`,
        retryable: true,
      };
    }
    const replaced = content.replace(oldStr, newStr);
    fs.writeFileSync(resolved.fullPath, replaced);
    return {
      result: JSON.stringify({ file: pathArg, success: true, replaced: 1 }),
    };
  } catch (err) {
    return { error: `edit failed: ${err}` };
  }
});

registerTool('write_file', (args, context): ToolResult => {
  const pathArg = str(args.path);
  const content = str(args.content);
  if (!pathArg) return { error: 'missing path argument' };
  if (content === undefined) return { error: 'missing content argument' };
  const resolved = resolvePath(pathArg, context);
  if ('error' in resolved) return { error: resolved.error };
  try {
    fs.mkdirSync(path.dirname(resolved.fullPath), { recursive: true });
    fs.writeFileSync(resolved.fullPath, content);
    return {
      result: JSON.stringify({
        file: pathArg,
        bytes: content.length,
        success: true,
      }),
    };
  } catch (err) {
    return { error: `write failed: ${err}` };
  }
});

const blockedCommandPrefixes = ['rm -rf /', 'mkfs', 'dd if=', ':(){ :|:& };:'];

function truncateRunOutput(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return (
    s.slice(0, maxChars) +
    '\n\n(truncated; output exceeded ' +
    maxChars +
    ' chars)'
  );
}

registerTool('run_command', (args, context): ToolResult => {
  const raw = str(args.command);
  if (!raw) return { error: 'missing command argument' };
  const command = raw.trim();
  if (!command) return { error: 'command cannot be empty' };
  const blocked = blockedCommandPrefixes.find((p) => command.startsWith(p));
  if (blocked) return { error: `blocked command: ${blocked}` };
  const maxOut = Math.floor(MAX_RUN_COMMAND_OUTPUT / 2);
  try {
    const result = execSync(command, {
      cwd: getProjectRoot(context),
      encoding: 'utf-8',
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const stdout = truncateRunOutput((result as string).trimEnd(), maxOut);
    const payload = {
      command,
      stdout,
      stderr: '',
      exit_code: 0,
      success: true,
    };
    let out = JSON.stringify(payload);
    if (out.length > MAX_RUN_COMMAND_OUTPUT) {
      const stdout2 = truncateRunOutput((result as string).trimEnd(), 2000);
      out = JSON.stringify({ ...payload, stdout: stdout2 });
    }
    return { result: out };
  } catch (err: unknown) {
    const ex = err as { status?: number; stdout?: string; stderr?: string };
    const code = ex.status ?? -1;
    let stdout = (ex.stdout as string)?.trimEnd() ?? '';
    let stderr = (ex.stderr as string)?.trimEnd() ?? '';
    stdout = truncateRunOutput(stdout, maxOut);
    stderr = truncateRunOutput(stderr, maxOut);
    let out = JSON.stringify({
      command,
      stdout,
      stderr,
      exit_code: code,
      success: false,
      error: String(err),
    });
    if (out.length > MAX_RUN_COMMAND_OUTPUT) {
      stdout = truncateRunOutput(stdout, 2000);
      stderr = truncateRunOutput(stderr, 2000);
      out = JSON.stringify({
        command,
        stdout,
        stderr,
        exit_code: code,
        success: false,
        error: String(err),
      });
    }
    return { result: out };
  }
});

registerTool('create_plan', (args, context): ToolResult => {
  const filename = str(args.filename);
  const content = str(args.content);
  if (!filename) return { error: 'missing filename argument' };
  if (content === undefined) return { error: 'missing content argument' };
  if (filename.includes('/') || filename.includes('\\')) {
    return { error: 'filename should not contain path separators' };
  }
  const planPath = path.join('.konstruct', 'plans', filename);
  const resolved = resolvePath(planPath, context);
  if ('error' in resolved) return { error: resolved.error };
  try {
    fs.mkdirSync(path.dirname(resolved.fullPath), { recursive: true });
    fs.writeFileSync(resolved.fullPath, content);
    const doc = documentStore.addDocument({
      title: filename.replace(/\.(md|markdown)$/i, '') || filename,
      content,
      type: 'plan',
    });
    return {
      result: JSON.stringify({
        filename,
        path: planPath,
        bytes: content.length,
        success: true,
        documentId: doc.id,
        documentUrl: `/doc/${doc.id}`,
      }),
    };
  } catch (err) {
    return { error: `failed to write plan: ${err}` };
  }
});

registerTool('create_design', (args, context): ToolResult => {
  const filename = str(args.filename);
  const content = str(args.content);
  if (!filename) return { error: 'missing filename argument' };
  if (content === undefined) return { error: 'missing content argument' };
  if (filename.includes('/') || filename.includes('\\')) {
    return { error: 'filename should not contain path separators' };
  }
  const designPath = path.join('.konstruct', 'designs', filename);
  const resolved = resolvePath(designPath, context);
  if ('error' in resolved) return { error: resolved.error };
  try {
    fs.mkdirSync(path.dirname(resolved.fullPath), { recursive: true });
    fs.writeFileSync(resolved.fullPath, content);
    const doc = documentStore.addDocument({
      title: filename.replace(/\.(md|markdown)$/i, '') || filename,
      content,
      type: 'design',
    });
    return {
      result: JSON.stringify({
        filename,
        path: designPath,
        bytes: content.length,
        success: true,
        documentId: doc.id,
        documentUrl: `/doc/${doc.id}`,
      }),
    };
  } catch (err) {
    return { error: `failed to write design: ${err}` };
  }
});

function editPlanOrDesign(
  kind: 'plan' | 'design',
  args: Record<string, unknown>,
  context?: ToolContext
): ToolResult {
  const filename = str(args.filename);
  const oldStr = str(args.old_string);
  const newStr = str(args.new_string);
  const toolName = kind === 'plan' ? 'edit_plan' : 'edit_design';
  if (!filename) return { error: `missing filename argument` };
  if (!oldStr) return { error: `missing old_string argument` };
  if (newStr === undefined) return { error: `missing new_string argument` };
  if (filename.includes('/') || filename.includes('\\')) {
    return { error: 'filename should not contain path separators' };
  }
  const subPath = path.join(
    '.konstruct',
    kind === 'plan' ? 'plans' : 'designs',
    filename
  );
  const resolved = resolvePath(subPath, context);
  if ('error' in resolved) return { error: resolved.error };
  try {
    const content = fs.readFileSync(resolved.fullPath, 'utf-8');
    const count = content.split(oldStr).length - 1;
    if (count === 0)
      return {
        error:
          'old_string not found in file. Use read_file_region to get exact content.',
        retryable: true,
      };
    if (count > 1)
      return {
        error: `old_string appears ${count} times; use a longer unique snippet.`,
        retryable: true,
      };
    const replaced = content.replace(oldStr, newStr);
    fs.writeFileSync(resolved.fullPath, replaced);
    return {
      result: JSON.stringify({ filename, path: subPath, success: true }),
    };
  } catch (err) {
    return { error: `${toolName} failed: ${err}` };
  }
}

registerTool('edit_plan', (args, context) => editPlanOrDesign('plan', args, context));
registerTool('edit_design', (args, context) => editPlanOrDesign('design', args, context));

registerTool('set_status', (args): ToolResult => {
  const desc = str(args.description);
  if (!desc) return { error: 'missing description argument' };
  return { result: JSON.stringify({ ok: true, description: desc }) };
});

registerTool('suggest_relevant_file', (args, context): ToolResult => {
  const filePath = str(args.path);
  if (!filePath?.trim()) return { error: 'missing path argument' };
  const sessionId = context?.sessionId;
  const projectRoot = getProjectRoot(context);
  if (!sessionId) return { error: 'no session — cannot suggest file' };
  const session = sessionStore.addSuggestedFile(sessionId, projectRoot, filePath.trim());
  if (!session) return { error: 'session not found' };
  return { result: `Added "${filePath.trim()}" to assistant suggestions.` };
});

registerTool('suggest_improvement', (args, context): ToolResult => {
  const filePath = str(args.file_path);
  const suggestion = str(args.suggestion);
  if (!filePath?.trim()) return { error: 'missing file_path argument' };
  if (!suggestion?.trim()) return { error: 'missing suggestion argument' };
  const sessionId = context?.sessionId;
  const projectRoot = getProjectRoot(context);
  if (!sessionId) return { error: 'no session — cannot suggest improvement' };
  const lineNumber = args.line_number != null ? Number(args.line_number) : undefined;
  const snippet = args.snippet != null ? str(args.snippet) : undefined;
  const session = sessionStore.addSuggestedImprovement(sessionId, projectRoot, {
    filePath: filePath.trim(),
    lineNumber: Number.isFinite(lineNumber) && lineNumber > 0 ? lineNumber : undefined,
    suggestion: suggestion.trim(),
    snippet: snippet?.trim(),
  });
  if (!session) return { error: 'session not found' };
  return { result: 'Added improvement suggestion for the user.' };
});

registerTool('list_todos', (args, context): ToolResult => {
  const sessionId = context?.sessionId;
  if (!sessionId) {
    return { result: '[]\n(no session — todo list empty)' };
  }
  const todos = sessionStore.listTodos(sessionId);
  return { result: JSON.stringify(todos, null, 2) };
});

registerTool('add_todo', (args, context): ToolResult => {
  const description = str(args.description);
  if (!description) return { error: 'missing description argument' };
  const sessionId = context?.sessionId;
  if (!sessionId) return { error: 'no session — cannot add todo' };
  const item = sessionStore.addTodo(sessionId, description);
  if (!item) return { error: 'session not found' };
  return { result: JSON.stringify(item, null, 2) };
});

registerTool('update_todo', (args, context): ToolResult => {
  const id = str(args.id);
  const status = str(args.status);
  if (!id) return { error: 'missing id argument' };
  if (!status) return { error: 'missing status argument' };
  const valid = ['pending', 'in_progress', 'completed'];
  if (!valid.includes(status)) {
    return { error: `status must be one of: ${valid.join(', ')}` };
  }
  const sessionId = context?.sessionId;
  if (!sessionId) return { error: 'no session — cannot update todo' };
  const ok = sessionStore.updateTodo(
    sessionId,
    id,
    status as 'pending' | 'in_progress' | 'completed'
  );
  if (!ok) return { error: 'todo not found' };
  return { result: `Updated todo ${id} to ${status}` };
});

registerTool('update_session_title', (args, context): ToolResult => {
  const title = str(args.title);
  if (!title || !title.trim())
    return { error: 'missing or empty title argument' };
  const sessionId = context?.sessionId;
  if (!sessionId) return { error: 'no session — cannot update title' };
  const session = sessionStore.updateSessionTitle(sessionId, title.trim());
  if (!session) return { error: 'session not found' };
  return { result: `Session title updated to: ${session.title}` };
});
