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
 * Agent worker entry point for Docker containers
 * Connects to server via WebSocket tunnel and executes tools
 */

import { runAgentLoop } from './runLoop';
import { createLogger } from '../shared/logger';

const log = createLogger('agent-docker');

// Agent configuration from environment
interface AgentConfig {
  serverUrl: string;
  agentId: string;
  authKey?: string;
  tunnelId?: string;
}

function getAgentConfig(): AgentConfig {
  return {
    serverUrl: process.env.SERVER_URL || 'http://localhost:3000',
    agentId: process.env.AGENT_ID || 'docker-agent',
    authKey: process.env.AUTH_KEY,
    tunnelId: process.env.AGENT_TUNNEL_ID,
  };
}

/**
 * Connect to server via WebSocket tunnel
 */
async function connectToServer(config: AgentConfig): Promise<void> {
  const { serverUrl, agentId, tunnelId } = config;

  log.info(`Connecting to server at ${serverUrl} as agent ${agentId}`);

  // In Docker, we'll use a simulated connection for now
  // In production, this would connect via the actual WebSocket tunnel
  if (!tunnelId) {
    log.warn('No tunnel ID provided, running in local mode');
  }

  // Start the agent loop
  try {
    await runAgentLoop({
      serverUrl,
      agentId,
      authKey: config.authKey,
      mode: 'docker',
    });
  } catch (error) {
    log.error(`Agent loop error: ${error}`);
    process.exit(1);
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const config = getAgentConfig();

  log.info('Starting Docker agent...');
  log.info(`Server URL: ${config.serverUrl}`);
  log.info(`Agent ID: ${config.agentId}`);

  // Validate configuration
  if (!config.serverUrl) {
    log.error('SERVER_URL environment variable is required');
    process.exit(1);
  }

  // Connect to server
  await connectToServer(config);
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  log.error(`Uncaught exception: ${error}`);
});

process.on('unhandledRejection', (reason) => {
  log.error(`Unhandled rejection: ${reason}`);
});

// Start the agent
main().catch((error) => {
  log.error(`Failed to start agent: ${error}`);
  process.exit(1);
});