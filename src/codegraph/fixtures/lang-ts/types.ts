/**
 * Shared types for lang-ts fixture.
 */

export interface User {
  id: string;
  name: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
