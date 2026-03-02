/*
 * Copyright 2026 John Ewart <john@johnewart.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use it except in compliance with the License.
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
 * Resolves secret references to actual secret values. Config stores only
 * pointers; this module resolves them at runtime.
 *
 * Supported formats:
 *   env:VAR_NAME     - value from process.env[VAR_NAME]
 *   1pass:op://...   - 1Password CLI: op read "op://Vault/Item/field"
 *   1pass:Vault/Item/field - short form, passed to op read as op://Vault/Item/field
 */

import { spawnSync } from 'child_process';
import { createLogger } from './logger';

const log = createLogger('secretResolver');

export class SecretResolutionError extends Error {
  constructor(
    message: string,
    public readonly ref: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'SecretResolutionError';
  }
}

/**
 * Resolve a secret reference to its value.
 * - env:VAR_NAME → process.env[VAR_NAME]
 * - 1pass:op://Vault/Item/field or 1pass:Vault/Item/field → op read
 */
export async function resolveSecretRef(ref: string): Promise<string> {
  const trimmed = (ref ?? '').trim();
  if (!trimmed) {
    throw new SecretResolutionError('Empty secret reference', ref);
  }

  if (trimmed.startsWith('env:')) {
    const varName = trimmed.slice(4).trim();
    if (!varName) throw new SecretResolutionError('env: ref missing variable name', ref);
    const value = typeof process !== 'undefined' ? process.env[varName] : undefined;
    if (value === undefined || value === '') {
      throw new SecretResolutionError(
        `Environment variable ${varName} is not set or is empty`,
        ref
      );
    }
    return value;
  }

  if (trimmed.startsWith('1pass:')) {
    const rest = trimmed.slice(6).trim();
    const opUri = rest.startsWith('op://') ? rest : `op://${rest}`;
    try {
      const result = spawnSync('op', ['read', opUri], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (result.error) throw result.error;
      if (result.status !== 0) {
        const stderr = (result.stderr ?? '').trim();
        throw new Error(stderr || `op exited with ${result.status}`);
      }
      const value = (result.stdout ?? '').trim();
      if (!value) {
        throw new SecretResolutionError(
          `1Password returned empty value for ${opUri}`,
          ref
        );
      }
      return value;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new SecretResolutionError(
        `Failed to read from 1Password (${opUri}): ${msg}`,
        ref,
        err
      );
    }
  }

  throw new SecretResolutionError(
    `Unsupported secret reference format. Use env:VAR_NAME or 1pass:op://Vault/Item/field`,
    ref
  );
}

/**
 * Synchronous resolve for env: only. Use when you cannot await (e.g. legacy sync path).
 * For 1pass: refs, use resolveSecretRef (async).
 */
export function resolveSecretRefSync(ref: string): string {
  const trimmed = (ref ?? '').trim();
  if (!trimmed) throw new SecretResolutionError('Empty secret reference', ref);
  if (!trimmed.startsWith('env:')) {
    throw new SecretResolutionError(
      'Sync resolution only supports env: references. Use resolveSecretRef() for 1pass:',
      ref
    );
  }
  const varName = trimmed.slice(4).trim();
  if (!varName) throw new SecretResolutionError('env: ref missing variable name', ref);
  const value = typeof process !== 'undefined' ? process.env[varName] : undefined;
  if (value === undefined || value === '') {
    throw new SecretResolutionError(
      `Environment variable ${varName} is not set or is empty`,
      ref
    );
  }
  return value;
}

/**
 * Returns true if the ref looks like a secret reference (env: or 1pass:).
 */
export function isSecretRef(ref: string | undefined): boolean {
  const t = (ref ?? '').trim();
  return t.startsWith('env:') || t.startsWith('1pass:');
}
