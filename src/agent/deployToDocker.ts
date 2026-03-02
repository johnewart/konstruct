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
 * Agent deployment utilities for Docker containers
 * Handles agent injection and configuration in Docker environments
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Agent configuration for Docker deployment
export interface DockerAgentConfig {
  serverUrl: string;
  agentId: string;
  authKey?: string;
  ports?: Record<string, number>;
}

/**
 * Generate agent configuration for Docker container
 */
export function generateDockerAgentConfig(config: DockerAgentConfig): string {
  return JSON.stringify(
    {
      serverUrl: config.serverUrl,
      agentId: config.agentId,
      authKey: config.authKey,
      ports: config.ports || { '8000/tcp': 8000 },
      environment: 'docker',
    },
    null,
    2
  );
}

/**
 * Create a Docker image with the agent pre-installed
 */
export async function buildAgentImage(
  imageName: string,
  config?: DockerAgentConfig
): Promise<{ success: boolean; imageId?: string; error?: string }> {
  try {
    // Check if Docker is available
    try {
      execSync('docker --version', { stdio: 'ignore' });
    } catch {
      return {
        success: false,
        error: 'Docker is not installed or not in PATH',
      };
    }

    // Create temporary directory for build context
    const tempDir = fs.mkdtempSync('/tmp/agent-build-');
    
    try {
      // Copy agent files to temp directory
      const agentSrcDir = path.join(__dirname, '..');
      const agentDistDir = path.join(agentSrcDir, 'dist', 'agent');
      
      if (!fs.existsSync(agentDistDir)) {
        return {
          success: false,
          error: 'Agent dist directory not found. Run build first.',
        };
      }

      // Create Dockerfile
      const dockerfilePath = path.join(tempDir, 'Dockerfile');
      const dockerfileContent = `
FROM node:20-alpine

# Install additional tools
RUN apk add --no-cache \
    git \
    bash \
    curl \
    wget

WORKDIR /app

# Copy agent files
COPY dist/ ./dist/
COPY src/ ./src/

# Install dependencies
RUN npm install --production

# Set environment variables
ENV NODE_ENV=production
ENV AGENT_MODE=docker
ENV AGENT_PORT=8000

EXPOSE 8000

CMD ["node", "dist/agent/agent-worker.js"]
`;
      fs.writeFileSync(dockerfilePath, dockerfileContent);

      // Build the image
      const buildResult = execSync(
        `docker build -t ${imageName} ${tempDir}`,
        { stdio: 'pipe' }
      );

      // Get image ID
      const imageIdResult = execSync(`docker images ${imageName} --format "{{.ID}}"`, {
        stdio: 'pipe',
      });

      return {
        success: true,
        imageId: imageIdResult.toString().trim(),
      };
    } finally {
      // Clean up temp directory
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Deploy agent to a new Docker container
 */
export async function deployAgentToDocker(
  config: DockerAgentConfig & { containerName?: string }
): Promise<{ success: boolean; containerId?: string; endpoint?: string; error?: string }> {
  try {
    // Check if Docker is available
    try {
      execSync('docker --version', { stdio: 'ignore' });
    } catch {
      return {
        success: false,
        error: 'Docker is not installed or not in PATH',
      };
    }

    const containerName = config.containerName || `konstruct-agent-${Date.now()}`;

    // Check if container already exists
    try {
      execSync(`docker inspect ${containerName}`, { stdio: 'pipe' });
      return {
        success: false,
        error: `Container "${containerName}" already exists`,
      };
    } catch {
      // Container doesn't exist, continue
    }

    // Build agent image if not already built
    const imageTag = `konstruct-agent:${config.agentId}`;
    
    try {
      execSync(`docker inspect ${imageTag}`, { stdio: 'pipe' });
    } catch {
      // Image doesn't exist, build it
      const buildResult = await buildAgentImage(imageTag);
      if (!buildResult.success) {
        return {
          success: false,
          error: `Failed to build agent image: ${buildResult.error}`,
        };
      }
    }

    // Generate Docker run command
    const ports = config.ports || { '8000/tcp': 8000 };
    const portArgs = Object.entries(ports)
      .map(([hostPort, containerPort]) => `-p ${hostPort}:${containerPort}`)
      .join(' ');

    // Create environment variables
    const envVars = [
      `SERVER_URL=${config.serverUrl}`,
      `AGENT_ID=${config.agentId}`,
      ...(config.authKey ? [`AUTH_KEY=${config.authKey}`] : []),
    ];

    const envArgs = envVars.map((v) => `-e ${v}`).join(' ');

    // Run container
    const runCommand = `docker run -d ${portArgs} ${envArgs} --name ${containerName} ${imageTag}`;
    execSync(runCommand);

    // Wait for container to start
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Get container IP
    const ipResult = execSync(
      `docker inspect ${containerName} --format '{{.NetworkSettings.IPAddress}}'`,
      { stdio: 'pipe' }
    );

    const containerIp = ipResult.toString().trim();

    return {
      success: true,
      containerId: containerName,
      endpoint: `http://${containerIp}:8000`,
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Stop and remove agent container
 */
export async function removeAgentContainer(containerId: string): Promise<void> {
  try {
    // Stop container
    execSync(`docker stop ${containerId}`, { stdio: 'pipe' });
    
    // Remove container
    execSync(`docker rm ${containerId}`, { stdio: 'pipe' });
  } catch (error) {
    throw new Error(`Failed to remove container: ${(error as Error).message}`);
  }
}

/**
 * Get agent container logs
 */
export async function getAgentContainerLogs(containerId: string): Promise<string> {
  try {
    const result = execSync(`docker logs ${containerId}`, { stdio: 'pipe' });
    return result.toString();
  } catch (error) {
    return `Failed to get logs: ${(error as Error).message}`;
  }
}

/**
 * Check if agent container is running
 */
export async function isAgentContainerRunning(containerId: string): Promise<boolean> {
  try {
    const result = execSync(
      `docker inspect ${containerId} --format='{{.State.Status}}'`,
      { stdio: 'pipe' }
    );
    return result.toString().trim() === 'running';
  } catch {
    return false;
  }
}