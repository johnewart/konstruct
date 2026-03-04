/**
 * Entry point for lang-ts fixture.
 */

import { API_BASE } from './constants';
import type { User, Result } from './types';
import { formatDate, unwrap } from './utils';

export function run(user: User): string {
  return formatDate(new Date().toISOString());
}

export { unwrap };
export type { Result };
