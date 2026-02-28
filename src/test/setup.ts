import { afterEach, expect, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Clean up after each test
afterEach(() => {
  cleanup();
});

// Add custom expect matchers
expect.extend({
  toBeInTheDocument(received) {
    const pass =
      received instanceof Element && document.body.contains(received);
    if (pass) {
      return {
        message: () => 'expected element to be in document',
        pass: true,
      };
    } else {
      return {
        message: () => 'expected element to be in document',
        pass: false,
      };
    }
  },
});
