/*
 * Copyright 2026 John Ewart <john@johnewart.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
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
