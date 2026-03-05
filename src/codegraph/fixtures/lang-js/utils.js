/**
 * Utility functions for lang-js fixture.
 */

import { DEFAULT_TIMEOUT_MS } from './constants.js';

export function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString();
}

export function delay(ms = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
