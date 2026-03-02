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

/**
 * Tests for Docker VM provisioning service
 */

import { describe, it, expect } from 'vitest';

describe('Docker VM Service', () => {
  describe('checkDockerAvailable', () => {
    it('should return true when Docker is installed', async () => {
      const { checkDockerAvailable } = await import('./vmDocker');
      const result = await checkDockerAvailable();
      expect(result).toBe(true);
    });
  });
});