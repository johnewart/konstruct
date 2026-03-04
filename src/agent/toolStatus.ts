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
 * Human-readable status string for each tool when invoked.
 * Broadcast in the chat so the user sees what the assistant is doing.
 */

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

const STATUS_FNS: Record<string, (args: Record<string, unknown>) => string> = {
  list_files: (args) => {
    const pathArg = str(args.path);
    const glob = str(args.glob);
    if (!pathArg) return 'Listing files…';
    return glob
      ? `Listing files in ${pathArg} (${glob})…`
      : `Listing files in ${pathArg}…`;
  },
  read_file_region: (args) => {
    const pathArg = str(args.path);
    const start = num(args.start_line);
    const end = num(args.end_line);
    if (!pathArg) return 'Reading file…';
    if (start != null && end != null)
      return `Reading ${pathArg} (lines ${start}-${end})…`;
    return `Reading ${pathArg}…`;
  },
  grep: (args) => {
    const pattern = str(args.pattern);
    const pathArg = str(args.path);
    if (!pattern) return 'Searching…';
    return pathArg
      ? `Searching for "${pattern.slice(0, 40)}${pattern.length > 40 ? '…' : ''}" in ${pathArg}…`
      : `Searching for "${pattern.slice(0, 40)}${pattern.length > 40 ? '…' : ''}"…`;
  },
  glob: (args) => {
    const pattern = str(args.pattern);
    const pathArg = str(args.path) ?? '.';
    if (!pattern) return 'Finding files…';
    return `Finding files matching ${pattern} in ${pathArg}…`;
  },
  codebase_outline: (args) => {
    const pathArg = str(args.path);
    const glob = str(args.glob);
    if (!pathArg) return 'Building codebase outline…';
    return glob ? `Outlining ${pathArg} (${glob})…` : `Outlining ${pathArg}…`;
  },
  search_code: (args) => {
    const pattern = str(args.pattern);
    const pathArg = str(args.path);
    if (!pattern) return 'Searching code…';
    return pathArg ? `Searching code in ${pathArg}…` : 'Searching code…';
  },
  edit_file: (args) => {
    const pathArg = str(args.path);
    if (!pathArg) return 'Editing file…';
    return `Editing file ${pathArg}…`;
  },
  write_file: (args) => {
    const pathArg = str(args.path);
    if (!pathArg) return 'Writing file…';
    return `Writing file ${pathArg}…`;
  },
  run_command: (args) => {
    const cmd = str(args.command);
    if (!cmd) return 'Running command…';
    const short = cmd.length > 50 ? cmd.slice(0, 47) + '…' : cmd;
    return `Running: ${short}`;
  },
  create_plan: (args) => {
    const filename = str(args.filename);
    if (!filename) return 'Creating plan…';
    return `Creating plan ${filename}…`;
  },
  create_design: (args) => {
    const filename = str(args.filename);
    if (!filename) return 'Creating design…';
    return `Creating design ${filename}…`;
  },
  edit_plan: (args) => {
    const filename = str(args.filename);
    if (!filename) return 'Editing plan…';
    return `Editing plan ${filename}…`;
  },
  edit_design: (args) => {
    const filename = str(args.filename);
    if (!filename) return 'Editing design…';
    return `Editing design ${filename}…`;
  },
  set_status: (args) => {
    const desc = str(args.description);
    return desc ?? 'Updating status…';
  },
  suggest_relevant_file: (args) => {
    const p = str(args.path);
    return p ? `Suggesting file: ${p}` : 'Suggesting relevant file…';
  },
  suggest_improvement: (args) => {
    const fp = str(args.file_path);
    const snip = str(args.suggestion)?.slice(0, 40);
    return fp ? `Suggesting improvement: ${fp}${snip ? ` — ${snip}…` : ''}` : 'Suggesting improvement…';
  },
  list_todos: () => 'Listing todos…',
  add_todo: (args) => {
    const desc = str(args.description);
    return desc
      ? `Adding todo: ${desc.slice(0, 40)}${desc.length > 40 ? '…' : ''}`
      : 'Adding todo…';
  },
  update_todo: (args) => {
    const status = str(args.status);
    if (!status) return 'Updating todo…';
    return `Updating todo (${status})…`;
  },
  update_session_title: (args) => {
    const title = str(args.title);
    return title
      ? `Updating session title: ${title.slice(0, 50)}${title.length > 50 ? '…' : ''}`
      : 'Updating session title…';
  },
};

export function getToolStatus(
  toolName: string,
  args: Record<string, unknown>
): string {
  const fn = STATUS_FNS[toolName];
  if (!fn) return `${toolName}…`;
  try {
    return fn(args);
  } catch {
    return `${toolName}…`;
  }
}
