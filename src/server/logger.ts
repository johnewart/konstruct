/**
 * Server-side logger with level gating via LOG_LEVEL and DEBUG.
 * LOG_LEVEL=debug|info|warn|error (default: info in production, debug when DEBUG=1 or NODE_ENV !== 'production').
 */

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type Level = (typeof LEVELS)[number];

function parseLevel(): Level {
  const env = process.env.LOG_LEVEL?.toLowerCase();
  if (env && LEVELS.includes(env as Level)) return env as Level;
  if (process.env.DEBUG === '1' || process.env.NODE_ENV !== 'production') {
    return 'debug';
  }
  return 'info';
}

const minLevel = parseLevel();
const levelIndex = (l: Level) => LEVELS.indexOf(l);

function enabled(level: Level): boolean {
  return levelIndex(level) >= levelIndex(minLevel);
}

function formatMessage(
  tag: string,
  level: string,
  message: string,
  args: unknown[]
): unknown[] {
  const prefix = `[${tag}] ${message}`;
  return args.length ? [prefix, ...args] : [prefix];
}

export function createLogger(tag: string) {
  return {
    debug(message: string, ...args: unknown[]) {
      if (enabled('debug')) {
        console.debug(...formatMessage(tag, 'debug', message, args));
      }
    },
    info(message: string, ...args: unknown[]) {
      if (enabled('info')) {
        console.log(...formatMessage(tag, 'info', message, args));
      }
    },
    warn(message: string, ...args: unknown[]) {
      if (enabled('warn')) {
        console.warn(...formatMessage(tag, 'warn', message, args));
      }
    },
    error(message: string, ...args: unknown[]) {
      if (enabled('error')) {
        console.error(...formatMessage(tag, 'error', message, args));
      }
    },
  };
}
