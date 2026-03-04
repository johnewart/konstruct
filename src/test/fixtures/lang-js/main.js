/**
 * Entry point for lang-js fixture.
 */

import { API_BASE, MAX_RETRIES } from './constants.js';
import { formatDate, delay, clamp } from './utils.js';

export function run() {
  console.log(API_BASE, MAX_RETRIES);
  return formatDate(new Date().toISOString());
}

export { clamp };
