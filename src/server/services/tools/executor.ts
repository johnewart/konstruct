import path from 'path';
import type { ChatMessage } from '../sessionStore';

export interface ToolResult {
  result?: string;
  error?: string;
  retryable?: boolean;
}

const projectRoot = process.env.PROJECT_ROOT ?? process.cwd();

export function resolvePath(
  relativePath: string
): { fullPath: string } | { error: string } {
  const fullPath = path.join(projectRoot, relativePath);
  const absPath = path.resolve(fullPath);
  const absRoot = path.resolve(projectRoot);
  const sep = path.sep;
  if (absRoot && absPath !== absRoot && !absPath.startsWith(absRoot + sep)) {
    return { error: 'path outside project root' };
  }
  return { fullPath: absPath };
}

export interface ToolContext {
  sessionId?: string;
}

type Runner = (
  args: Record<string, unknown>,
  context?: ToolContext
) => Promise<ToolResult> | ToolResult;

const runners: Record<string, Runner> = {};

export function registerTool(name: string, fn: Runner) {
  runners[name] = fn;
}

export function executeTool(
  name: string,
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<ToolResult> {
  const fn = runners[name];
  if (!fn) {
    return Promise.resolve({ error: `unknown tool: ${name}` });
  }
  return Promise.resolve(fn(args, context));
}

export function getProjectRoot(): string {
  return projectRoot;
}
