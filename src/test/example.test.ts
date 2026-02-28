import { expect, test } from 'vitest';

// Simple test to verify the testing setup works
test('should pass a simple test', () => {
  expect(true).toBe(true);
});

test('should add two numbers correctly', () => {
  const result = 2 + 2;
  expect(result).toBe(4);
});

// Example of an async test
test('async test should resolve', async () => {
  const result = await Promise.resolve(42);
  expect(result).toBe(42);
});
