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
 * WebSocket tunnel service for remote agent communication
 * Establishes secure tunnels between server and remote agents
 */

import { createLogger } from '../../shared/logger';
import { WebSocket, WebSocketServer } from 'ws';
import * as http from 'http';

const log = createLogger('tunnel');

// Tunnel session information
export interface TunnelSession {
  id: string;
  agentId: string;
  containerId?: string;
  provider: string;
  createdAt: string;
  lastActive: string;
  status: 'connecting' | 'connected' | 'disconnected';
  endpoint?: string;
  wss?: WebSocket;
}

// In-memory store for active tunnels
const activeTunnels = new Map<string, TunnelSession>();

/**
 * Generate a secure tunnel token
 */
export function generateTunnelToken(): string {
  return crypto.randomUUID();
}

/**
 * Create a new tunnel session
 */
export function createTunnel(
  agentId: string,
  provider: string,
  containerId?: string
): { success: boolean; tunnelId?: string; error?: string } {
  try {
    const tunnelId = generateTunnelToken();
    
    const session: TunnelSession = {
      id: tunnelId,
      agentId,
      containerId,
      provider,
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      status: 'connecting',
    };

    activeTunnels.set(tunnelId, session);
    log.info(`Created tunnel ${tunnelId} for agent ${agentId}`);

    return {
      success: true,
      tunnelId,
    };
  } catch (error) {
    log.error(`Error creating tunnel: ${error}`);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Connect a tunnel to a WebSocket
 */
export function connectTunnel(
  tunnelId: string,
  ws: WebSocket
): { success: boolean; error?: string } {
  try {
    const session = activeTunnels.get(tunnelId);
    if (!session) {
      return {
        success: false,
        error: `Tunnel ${tunnelId} not found`,
      };
    }

    session.wss = ws;
    session.status = 'connected';
    session.lastActive = new Date().toISOString();

    // Set up WebSocket event handlers
    ws.on('message', (data: WebSocket.Data) => {
      handleTunnelMessage(tunnelId, data);
    });

    ws.on('close', () => {
      session.status = 'disconnected';
      session.wss = undefined;
      log.info(`Tunnel ${tunnelId} disconnected`);
    });

    ws.on('error', (error: Error) => {
      log.error(`Tunnel ${tunnelId} error: ${error}`);
      session.status = 'disconnected';
    });

    log.info(`Tunnel ${tunnelId} connected`);

    return {
      success: true,
    };
  } catch (error) {
    log.error(`Error connecting tunnel: ${error}`);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Handle incoming tunnel messages
 */
function handleTunnelMessage(tunnelId: string, data: WebSocket.Data): void {
  try {
    const session = activeTunnels.get(tunnelId);
    if (!session) {
      log.warn(`Received message for unknown tunnel ${tunnelId}`);
      return;
    }

    // Parse the message
    let message: { type: string; payload?: unknown };
    try {
      message = JSON.parse(data.toString());
    } catch {
      log.error(`Invalid message format for tunnel ${tunnelId}`);
      return;
    }

    // Route message based on type
    switch (message.type) {
      case 'agent-ready':
        session.status = 'connected';
        session.lastActive = new Date().toISOString();
        log.info(`Agent ${session.agentId} ready via tunnel ${tunnelId}`);
        break;

      case 'tool-result':
        // Forward tool results to the server
        log.debug(`Tool result from agent ${session.agentId}`);
        break;

      case 'agent-stdout':
        // Forward stdout output
        log.debug(`Stdout from agent ${session.agentId}: ${message.payload}`);
        break;

      case 'agent-stderr':
        // Forward stderr output
        log.warn(`Stderr from agent ${session.agentId}: ${message.payload}`);
        break;

      default:
        log.warn(`Unknown message type: ${message.type}`);
    }
  } catch (error) {
    log.error(`Error handling tunnel message: ${error}`);
  }
}

/**
 * Send message through tunnel
 */
export function sendToTunnel(
  tunnelId: string,
  message: { type: string; payload?: unknown }
): { success: boolean; error?: string } {
  try {
    const session = activeTunnels.get(tunnelId);
    if (!session || !session.wss) {
      return {
        success: false,
        error: `Tunnel ${tunnelId} not connected`,
      };
    }

    if (session.wss.readyState !== WebSocket.OPEN) {
      return {
        success: false,
        error: `Tunnel ${tunnelId} WebSocket not open`,
      };
    }

    session.wss.send(JSON.stringify(message));
    session.lastActive = new Date().toISOString();

    return {
      success: true,
    };
  } catch (error) {
    log.error(`Error sending to tunnel ${tunnelId}: ${error}`);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Disconnect and remove a tunnel
 */
export function disconnectTunnel(tunnelId: string): void {
  const session = activeTunnels.get(tunnelId);
  if (session && session.wss) {
    try {
      session.wss.close();
    } catch {
      // Ignore close errors
    }
  }
  activeTunnels.delete(tunnelId);
  log.info(`Tunnel ${tunnelId} disconnected and removed`);
}

/**
 * List all active tunnels
 */
export function listActiveTunnels(): TunnelSession[] {
  return Array.from(activeTunnels.values());
}

/**
 * Get tunnel by ID
 */
export function getTunnel(tunnelId: string): TunnelSession | undefined {
  return activeTunnels.get(tunnelId);
}

/**
 * Clean up expired tunnels (older than 1 hour)
 */
export function cleanupExpiredTunnels(): number {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  let removed = 0;

  for (const [tunnelId, session] of activeTunnels.entries()) {
    const createdAt = new Date(session.createdAt).getTime();
    if (createdAt < oneHourAgo) {
      disconnectTunnel(tunnelId);
      removed++;
    }
  }

  return removed;
}

/**
 * Start tunnel server for incoming connections
 * Note: This is not needed when using host.docker.internal
 * The agent connects back to the server directly via HTTP/WebSocket
 */
export function startTunnelServer(port: number): { success: boolean; url?: string; error?: string } {
  try {
    const wss = new WebSocketServer({ port });

    wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
      // Extract tunnel ID from URL or headers
      const url = new URL(req.url || '', `http://localhost:${port}`);
      const tunnelId = url.pathname.replace('/', '');

      if (!tunnelId) {
        ws.close(4001, 'Missing tunnel ID');
        return;
      }

      const result = connectTunnel(tunnelId, ws);
      if (!result.success) {
        ws.close(4002, result.error || 'Invalid tunnel');
        return;
      }

      // Send confirmation
      ws.send(JSON.stringify({ type: 'tunnel-confirmed', tunnelId }));
    });

    wss.on('error', (error: Error) => {
      log.error(`Tunnel server error: ${error}`);
    });

    log.info(`Tunnel server started on port ${port}`);

    return {
      success: true,
      url: `ws://localhost:${port}`,
    };
  } catch (error) {
    log.error(`Error starting tunnel server: ${error}`);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Get agent endpoint via tunnel
 */
export function getAgentEndpoint(tunnelId: string): string | undefined {
  const session = activeTunnels.get(tunnelId);
  if (session && session.endpoint) {
    return session.endpoint;
  }
  
  // Generate default endpoint based on provider
  if (session?.provider === 'docker') {
    return `http://host.docker.internal:8000`;
  }
  
  return undefined;
}
