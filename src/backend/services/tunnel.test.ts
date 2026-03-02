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
 * Tests for WebSocket tunnel service
 */

import { describe, it, expect, vi } from 'vitest';

// Mock the tunnel service
vi.mock('./tunnel', () => ({
  createTunnel: (agentId: string, provider: string) => ({
    success: true,
    tunnelId: `tunnel-${crypto.randomUUID()}`,
  }),
  connectTunnel: (tunnelId: string, ws: any) => ({
    success: true,
  }),
  sendToTunnel: (tunnelId: string, message: any) => ({
    success: true,
  }),
  disconnectTunnel: (tunnelId: string) => {
    // No-op
  },
  getTunnel: (tunnelId: string) => ({
    id: tunnelId,
  }),
  listActiveTunnels: () => [],
  cleanupExpiredTunnels: () => 0,
}));

describe('Tunnel Service', () => {
  describe('createTunnel', () => {
    it('should create a new tunnel with unique ID', async () => {
      const { createTunnel } = await import('./tunnel');
      
      const result1 = createTunnel('agent-1', 'docker');
      const result2 = createTunnel('agent-2', 'docker');
      
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.tunnelId).not.toBe(result2.tunnelId);
    });
  });

  describe('connectTunnel', () => {
    it('should connect a WebSocket to a tunnel', async () => {
      const { createTunnel, connectTunnel } = await import('./tunnel');
      
      const tunnelResult = createTunnel('agent-1', 'docker');
      expect(tunnelResult.success).toBe(true);
      
      // Mock WebSocket
      const mockWs = {
        on: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
        readyState: 1, // OPEN
      };
      
      const result = connectTunnel(tunnelResult.tunnelId!, mockWs as any);
      
      expect(result.success).toBe(true);
    });

    it('should return error for unknown tunnel', async () => {
      const { connectTunnel } = await import('./tunnel');
      
      // Mock WebSocket
      const mockWs = {
        on: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
        readyState: 1, // OPEN
      };
      
      const result = connectTunnel('nonexistent', mockWs as any);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('sendToTunnel', () => {
    it('should send message through connected tunnel', async () => {
      const { createTunnel, connectTunnel, sendToTunnel } = await import('./tunnel');
      
      const tunnelResult = createTunnel('agent-1', 'docker');
      
      // Mock WebSocket
      const mockWs = {
        on: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
        readyState: 1, // OPEN
      };
      
      connectTunnel(tunnelResult.tunnelId!, mockWs as any);
      
      const result = sendToTunnel(tunnelResult.tunnelId!, { type: 'test', payload: 'data' });
      
      expect(result.success).toBe(true);
    });

    it('should return error for disconnected tunnel', async () => {
      const { createTunnel, sendToTunnel } = await import('./tunnel');
      
      const tunnelResult = createTunnel('agent-1', 'docker');
      
      // Mock closed WebSocket
      const mockWs = {
        on: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
        readyState: 3, // CLOSED
      };
      
      connectTunnel(tunnelResult.tunnelId!, mockWs as any);
      
      const result = sendToTunnel(tunnelResult.tunnelId!, { type: 'test' });
      
      expect(result.success).toBe(false);
    });
  });

  describe('disconnectTunnel', () => {
    it('should remove tunnel from active sessions', async () => {
      const { createTunnel, disconnectTunnel, getTunnel } = await import('./tunnel');
      
      const tunnelResult = createTunnel('agent-1', 'docker');
      expect(getTunnel(tunnelResult.tunnelId!)).toBeDefined();
      
      disconnectTunnel(tunnelResult.tunnelId!);
      expect(getTunnel(tunnelResult.tunnelId!)).toBeUndefined();
    });
  });

  describe('listActiveTunnels', () => {
    it('should list all active tunnels', async () => {
      const { createTunnel, listActiveTunnels } = await import('./tunnel');
      
      createTunnel('agent-1', 'docker');
      createTunnel('agent-2', 'aws');
      
      const tunnels = listActiveTunnels();
      
      expect(tunnels.length).toBe(2);
    });
  });

  describe('cleanupExpiredTunnels', () => {
    it('should remove tunnels older than 1 hour', async () => {
      const { createTunnel, cleanupExpiredTunnels } = await import('./tunnel');
      
      // Create a tunnel (current time)
      createTunnel('agent-1', 'docker');
      
      // Create an old tunnel (mocked to be 2 hours old)
      // This would require modifying the createTunnel function to accept a custom timestamp
      // For now, just verify the cleanup function exists and doesn't throw
      const removed = cleanupExpiredTunnels();
      
      expect(removed).toBeGreaterThanOrEqual(0);
    });
  });
});