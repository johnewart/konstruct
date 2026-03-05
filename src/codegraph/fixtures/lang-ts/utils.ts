/**
 * Utility functions for lang-ts fixture.
 */

import { DEFAULT_TIMEOUT_MS } from './constants';
import type { Result } from './types';

export function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString();
}

export function delay(ms: number = DEFAULT_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function unwrap<T>(r: Result<T>): T {
  if (r.ok) return r.value;
  throw new Error(r.error);
}
