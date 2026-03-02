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
 * Docker VM provisioning service
 * Manages Docker containers for remote agent execution
 */

import { createLogger } from '../../shared/logger';
import Dockerode from 'dockerode';
import * as fs from 'fs';
import * as path from 'path';

const log = createLogger('vm-docker');

// Agent configuration for Docker deployment
export interface DockerAgentConfig {
  serverUrl?: string;
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

// Docker container configuration
export interface DockerConfig {
  image?: string;
  name?: string;
  ports?: Record<string, number>;
  env?: Record<string, string>;
  volumes?: Record<string, string>;
  network?: string;
}

// VM info structure for Docker containers
export interface DockerVMInfo {
  id: string;
  name: string;
  provider: 'docker';
  status: 'pending' | 'running' | 'stopped' | 'error' | 'exited';
  createdAt: string;
  endpoint?: string;
  agentEndpoint?: string;  // Agent runs on host.docker.internal
  ports?: Record<string, number>;
  containerId?: string;
  error?: string;
}

// Result from provisioning operation
export interface DockerProvisionResult {
  success: boolean;
  vmId?: string;
  provider: 'docker';
  endpoint?: string;
  tunnelUrl?: string;
  containerId?: string;
  agentEndpoint?: string;  // Agent runs on host.docker.internal:<port>
  error?: string;
}

// In-memory store for active containers (in production, use database)
const activeContainers = new Map<string, DockerVMInfo>();

// Docker client instance
let docker: Dockerode | null = null;

/**
 * Get Docker client instance
 */
function getDockerClient(): Dockerode {
  if (!docker) {
    docker = new Dockerode();
  }
  return docker;
}

/**
 * Check if Docker is available
 */
export async function checkDockerAvailable(): Promise<boolean> {
  try {
    const dockerClient = getDockerClient();
    await dockerClient.ping();
    return true;
  } catch {
    return false;
  }
}

/**
 * Provision a new Docker container for agent execution
 */
export async function provisionDocker(config: DockerConfig): Promise<DockerProvisionResult> {
  try {
    // Check if Docker is available
    const dockerAvailable = await checkDockerAvailable();
    if (!dockerAvailable) {
      return {
        success: false,
        provider: 'docker',
        error: 'Docker is not installed or not in PATH',
      };
    }

    const dockerClient = getDockerClient();
    
    // Generate container name if not provided
    const containerName = config.name || `konstruct-agent-${Date.now()}`;
    
    // Check if container with same name already exists
    try {
      await dockerClient.getContainer(containerName).inspect();
      return {
        success: false,
        provider: 'docker',
        error: `Container "${containerName}" already exists`,
      };
    } catch (err) {
      // Container doesn't exist, continue with provisioning
      // Error will be "Container not found" which is expected
    }

    // Build container options
    const containerOptions: Dockerode.ContainerCreateOptions = {
      name: containerName,
      Image: config.image || 'ubuntu:latest',
      Tty: false,
      // Keep container running by default (use tail instead of bash)
      Cmd: ['tail', '-f', '/dev/null'],
    };

    // Add ports mapping
    if (config.ports) {
      const exposedPorts: Record<string, {}> = {};
      const portBindings: Record<string, Array<{ HostPort: string }>> = {};
      
      for (const [containerPort, hostPort] of Object.entries(config.ports)) {
        exposedPorts[`${containerPort}/tcp`] = {};
        portBindings[`${containerPort}/tcp`] = [{ HostPort: String(hostPort) }];
      }
      
      containerOptions.ExposedPorts = exposedPorts;
      containerOptions.HostConfig = {
        PortBindings: portBindings,
      };
    }

    // Add environment variables
    if (config.env) {
      containerOptions.Env = Object.entries(config.env).map(([key, value]) => `${key}=${value}`);
    }

    // Add volumes if provided
    if (config.volumes) {
      if (!containerOptions.HostConfig) {
        containerOptions.HostConfig = {};
      }
      containerOptions.HostConfig.Binds = Object.entries(config.volumes).map(
        ([hostPath, containerPath]) => `${hostPath}:${containerPath}`
      );
    }

    // Add network if specified
    if (config.network) {
      if (!containerOptions.HostConfig) {
        containerOptions.HostConfig = {};
      }
      containerOptions.HostConfig.NetworkMode = config.network;
    }

    log.info(`Creating container: ${containerName} from image: ${containerOptions.Image}`);

    // Pull image first to ensure it exists
    try {
      log.info(`Pulling image: ${containerOptions.Image}`);
      await dockerClient.pull(containerOptions.Image || 'ubuntu:latest', {});
    } catch (err) {
      log.warn(`Failed to pull image: ${err}`);
      // Continue anyway - image might already be local
    }

    // Create and start the container
    const container = await dockerClient.createContainer(containerOptions);
    await container.start();

    log.info(`Container started: ${container.id}`);

    // Get container status
    const info = await container.inspect();
    let status: 'pending' | 'running' | 'stopped' | 'error' | 'exited' = 
      info.State.Status as 'pending' | 'running' | 'stopped' | 'error' | 'exited';
    
    // Map Docker status to our status types
    if (info.State.Status === 'exited') {
      status = 'stopped';  // Treat exited as stopped for UI purposes
    }

    // Generate endpoint if ports are configured
    let endpoint: string | undefined;
    let agentEndpoint: string | undefined;
    
    if (config.ports && Object.keys(config.ports).length > 0) {
      const hostPort = Object.keys(config.ports)[0];
      endpoint = `http://localhost:${hostPort}`;
      // Agent runs on host.docker.internal so it can reach back to the server
      agentEndpoint = `http://host.docker.internal:${hostPort}`;
    }

    const vmInfo: DockerVMInfo = {
      id: container.id.substring(0, 12),
      name: containerName,
      provider: 'docker',
      status,
      createdAt: new Date().toISOString(),
      endpoint,
      agentEndpoint,
      ports: config.ports,
      containerId: container.id,
    };

    activeContainers.set(container.id, vmInfo);

    return {
      success: true,
      vmId: container.id.substring(0, 12),
      provider: 'docker',
      endpoint,
      agentEndpoint,
      containerId: container.id,
    };
  } catch (error) {
    log.error(`Error provisioning Docker container: ${error}`);
    return {
      success: false,
      provider: 'docker',
      error: (error as Error).message || 'Failed to provision Docker container',
    };
  }
}

/**
 * Start a stopped Docker container
 */
export async function startDockerContainer(vmId: string): Promise<DockerProvisionResult> {
  try {
    const dockerClient = getDockerClient();
    
    // Find container by ID or name
    let container: Dockerode.Container;
    try {
      container = dockerClient.getContainer(vmId);
      await container.inspect();
    } catch (err) {
      return {
        success: false,
        provider: 'docker',
        error: `Container "${vmId}" not found`,
      };
    }

    await container.start();

    // Update status
    const info = await container.inspect();
    const status = info.State.Status as 'pending' | 'running' | 'stopped' | 'error';

    if (activeContainers.has(container.id)) {
      activeContainers.set(container.id, {
        ...activeContainers.get(container.id)!,
        status,
      });
    }

    return {
      success: true,
      provider: 'docker',
      containerId: container.id,
    };
  } catch (error) {
    log.error(`Error starting Docker container ${vmId}: ${error}`);
    return {
      success: false,
      provider: 'docker',
      error: (error as Error).message || `Failed to start container ${vmId}`,
    };
  }
}

/**
 * Stop a running Docker container
 */
export async function stopDockerContainer(vmId: string): Promise<DockerProvisionResult> {
  try {
    const dockerClient = getDockerClient();
    
    // Find container by ID or name
    let container: Dockerode.Container;
    try {
      container = dockerClient.getContainer(vmId);
      await container.inspect();
    } catch (err) {
      return {
        success: false,
        provider: 'docker',
        error: `Container "${vmId}" not found`,
      };
    }

    await container.stop();

    // Update status
    const info = await container.inspect();
    const status = info.State.Status as 'pending' | 'running' | 'stopped' | 'error';

    if (activeContainers.has(container.id)) {
      activeContainers.set(container.id, {
        ...activeContainers.get(container.id)!,
        status,
      });
    }

    return {
      success: true,
      provider: 'docker',
      containerId: container.id,
    };
  } catch (error) {
    log.error(`Error stopping Docker container ${vmId}: ${error}`);
    return {
      success: false,
      provider: 'docker',
      error: (error as Error).message || `Failed to stop container ${vmId}`,
    };
  }
}

/**
 * Delete a Docker container
 */
export async function deleteDockerContainer(vmId: string): Promise<void> {
  try {
    const dockerClient = getDockerClient();
    
    // Find container by ID or name
    let container: Dockerode.Container;
    try {
      container = dockerClient.getContainer(vmId);
      await container.inspect();
    } catch (err) {
      throw new Error(`Container "${vmId}" not found`);
    }

    // Stop container first if running
    const info = await container.inspect();
    if (info.State.Status === 'running') {
      await container.stop();
    }

    // Remove container
    await container.remove({ force: true });

    // Remove from active containers map
    activeContainers.delete(container.id);
  } catch (error) {
    log.error(`Error deleting Docker container ${vmId}: ${error}`);
    throw error;
  }
}

/**
 * List all active Docker containers managed by Konstruct
 */
export async function listDockerVMs(): Promise<DockerVMInfo[]> {
  try {
    const dockerClient = getDockerClient();
    
    // Get all containers
    const containers = await dockerClient.listContainers({ all: true });

    // Update local state with actual container status
    for (const [containerId, vmInfo] of activeContainers.entries()) {
      try {
        const container = dockerClient.getContainer(containerId);
        const info = await container.inspect();
        
        activeContainers.set(containerId, {
          ...vmInfo,
          status: info.State.Status as 'pending' | 'running' | 'stopped' | 'error',
        });
      } catch {
        // Container might have been removed externally
        activeContainers.delete(containerId);
      }
    }

    return Array.from(activeContainers.values());
  } catch (error) {
    log.error(`Error listing Docker containers: ${error}`);
    return [];
  }
}

/**
 * Find container ID by partial ID or name
 */
async function findContainerId(identifier: string): Promise<string | undefined> {
  try {
    const dockerClient = getDockerClient();
    const container = dockerClient.getContainer(identifier);
    await container.inspect();
    return container.id;
  } catch {
    // Container not found
    return undefined;
  }
}

/**
 * Get container logs
 */
export async function getContainerLogs(vmId: string): Promise<string> {
  try {
    const dockerClient = getDockerClient();
    
    let container: Dockerode.Container;
    try {
      container = dockerClient.getContainer(vmId);
      await container.inspect();
    } catch (err) {
      return `Container "${vmId}" not found`;
    }

    const logs = await container.logs({ stdout: true, stderr: true, tail: 100 });
    return logs.toString();
  } catch (error) {
    log.error(`Error getting logs for ${vmId}: ${error}`);
    return `Failed to get logs: ${(error as Error).message}`;
  }
}

/**
 * Execute command inside running container
 */
export async function executeInContainer(
  vmId: string,
  command: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const dockerClient = getDockerClient();
    
    let container: Dockerode.Container;
    try {
      container = dockerClient.getContainer(vmId);
      const info = await container.inspect();
      
      if (info.State.Status !== 'running') {
        return {
          stdout: '',
          stderr: `Container "${vmId}" is not running`,
          exitCode: 1,
        };
      }
    } catch (err) {
      return {
        stdout: '',
        stderr: `Container "${vmId}" not found`,
        exitCode: 1,
      };
    }

    const exec = await container.exec({
      AttachStdout: true,
      AttachStderr: true,
      Cmd: command,
    });

    const stream = await exec.start({ Detach: false });
    
    // We need to attach to get the output
    const attachedExec = await container.exec({
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      Cmd: command,
    });
    
    const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      
      attachedExec.start(
        { Detach: false },
        ((err: Error | null, stream: NodeJS.ReadWriteStream) => {
          if (err) {
            reject(err);
            return;
          }
          
          stream.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
          });
          
          stream.on('error', (err) => {
            stderr += err.message;
          });
          
          stream.on('end', () => {
            resolve({ stdout, stderr });
          });
        }) as any
      );
    });

    // Get exit code
    const info = await container.inspect();
    const execInfo = info.ExecIDs ? info.ExecIDs[0] : undefined;
    
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0, // Note: getting actual exit code requires more complex handling
    };
  } catch (error) {
    log.error(`Error executing command in ${vmId}: ${error}`);
    return {
      stdout: '',
      stderr: `Failed to execute command: ${(error as Error).message}`,
      exitCode: 1,
    };
  }
}

/**
 * Wait for container to be ready (running and has IP)
 */
export async function waitForContainerReady(
  vmId: string,
  timeoutMs: number = 30000
): Promise<{ success: boolean; containerIp?: string; error?: string }> {
  const startTime = Date.now();
  
  log.info(`Waiting for container "${vmId}" to be ready (timeout: ${timeoutMs}ms)`);
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const dockerClient = getDockerClient();
      const container = dockerClient.getContainer(vmId);
      const info = await container.inspect();
      
      log.debug(`Container "${vmId}" status: ${info.State.Status}`);
      
      // Check if container is running
      if (info.State.Status !== 'running') {
        log.debug(`Container "${vmId}" not running yet, waiting...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      
      // Get container IP address
      const networks = info.NetworkSettings?.Networks;
      const networkNames = Object.keys(networks || {});
      log.debug(`Container "${vmId}" networks: ${JSON.stringify(networks)}`);
      log.debug(`Network names: ${networkNames}`);
      
      const containerIp = networkNames.length > 0 
        ? (networks![networkNames[0]].IPAddress || '') 
        : '';
      
      log.debug(`Container "${vmId}" IP: ${containerIp || 'none'}`);
      
      if (containerIp && containerIp !== '') {
        log.info(`Container "${vmId}" is ready with IP ${containerIp}`);
        return { success: true, containerIp };
      }
      
      log.debug(`Container "${vmId}" has no IP yet, waiting...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (err) {
      const errorMsg = `Error checking container status: ${(err as Error).message}`;
      log.error(errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }
  
  const errorMsg = `Timeout waiting for container "${vmId}" to be ready after ${timeoutMs}ms`;
  log.error(errorMsg);
  return {
    success: false,
    error: errorMsg,
  };
}

/**
 * Deploy agent to a running Docker container
 * This function configures and starts the agent inside an existing container
 */
export async function deployAgentToContainer(
  vmId: string,
  serverUrl: string,
  agentId: string
): Promise<{ success: boolean; endpoint?: string; error?: string }> {
  log.info(`Starting deployment of agent to container ${vmId}`);
  
  try {
    const dockerClient = getDockerClient();
    
    // Find container by ID or name
    let container: Dockerode.Container;
    try {
      container = dockerClient.getContainer(vmId);
      log.debug(`Container "${vmId}" found`);
      await container.inspect();
      log.debug(`Container "${vmId}" inspected successfully`);
    } catch (err) {
      const errorMsg = `Container "${vmId}" not found: ${(err as Error).message}`;
      log.error(errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }

    // Wait for container to be ready
    log.info(`Waiting for container ${vmId} to be ready...`);
    const readyResult = await waitForContainerReady(vmId, 30000);
    if (!readyResult.success) {
      const errorMsg = `Container ${vmId} not ready: ${readyResult.error}`;
      log.error(errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
    
    const containerIp = readyResult.containerIp!;
    log.info(`Container ${vmId} is ready at IP ${containerIp}`);
    
    // Get container info for ports and status
    const info = await container.inspect();
    log.debug(`Container ${vmId} state: ${JSON.stringify(info.State)}`);

    // Get the ports the container is exposing
    const ports = info.Config.ExposedPorts || {};
    log.debug(`Container ${vmId} exposed ports: ${JSON.stringify(ports)}`);
    
    const agentPort = Object.keys(ports).length > 0 
      ? Object.keys(ports)[0].split('/')[0] 
      : '8000';
    log.info(`Using agent port: ${agentPort}`);

    // Set environment variables for agent connection back to server
    const envVars = {
      SERVER_URL: serverUrl,
      AGENT_PORT: agentPort,
      AGENT_ID: agentId,
      NODE_ENV: 'production',
    };
    log.debug(`Environment variables to set: ${JSON.stringify(envVars)}`);

    // Stop the container temporarily to reconfigure
    if (info.State.Status === 'running') {
      log.info(`Stopping container ${vmId} to apply new configuration...`);
      await container.stop();
      log.info(`Container ${vmId} stopped`);
    }

    // Update container with new environment variables
    // Note: dockerode update() accepts a config object for environment variables
    const updateConfig: Record<string, string[]> = {
      Env: Object.entries(envVars).map(([key, value]) => `${key}=${value}`),
    };
    log.debug(`Update config: ${JSON.stringify(updateConfig)}`);

    log.info(`Updating container ${vmId} with new environment variables...`);
    await container.update(updateConfig);
    log.info(`Container ${vmId} updated`);

    // Restart the container
    log.info(`Restarting container ${vmId}...`);
    await container.start();
    log.info(`Container ${vmId} restarted`);

    log.info(`Agent deployed to container ${vmId} at http://${containerIp}:${agentPort}`);

    return {
      success: true,
      endpoint: `http://${containerIp}:${agentPort}`,
    };
  } catch (error) {
    const errorMsg = `Error deploying agent to container ${vmId}: ${(error as Error).message}`;
    log.error(errorMsg);
    return {
      success: false,
      error: (error as Error).message || 'Failed to deploy agent',
    };
  }
}

/**
 * Get agent endpoint for a VM
 */
export function getAgentEndpoint(vmInfo: DockerVMInfo, serverUrl: string): string | undefined {
  // For Docker containers, the agent connects back to the server via WebSocket
  // The container can reach the server via host.docker.internal
  if (vmInfo.containerId) {
    return `${serverUrl.replace(/^http/, 'ws')}/agent-stream`;
  }
  
  return undefined;
}

/**
 * Inject agent into an existing running container
 * This is useful for containers that were created without the agent
 */
export async function injectAgentIntoContainer(
  vmId: string,
  serverUrl: string,
  agentId: string
): Promise<{ success: boolean; endpoint?: string; error?: string }> {
  log.info(`Starting injection of agent into container ${vmId}`);
  
  try {
    const dockerClient = getDockerClient();
    
    // Find container by ID or name
    let container: Dockerode.Container;
    try {
      container = dockerClient.getContainer(vmId);
      log.debug(`Container "${vmId}" found`);
      await container.inspect();
      log.debug(`Container "${vmId}" inspected successfully`);
    } catch (err) {
      const errorMsg = `Container "${vmId}" not found: ${(err as Error).message}`;
      log.error(errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }

    // Wait for container to be ready
    log.info(`Waiting for container ${vmId} to be ready...`);
    const readyResult = await waitForContainerReady(vmId, 30000);
    if (!readyResult.success) {
      const errorMsg = `Container ${vmId} not ready: ${readyResult.error}`;
      log.error(errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
    
    const containerIp = readyResult.containerIp!;
    log.info(`Container ${vmId} is ready at IP ${containerIp}`);
    
    // Get the ports the container is exposing
    const info = await container.inspect();
    log.debug(`Container ${vmId} state: ${JSON.stringify(info.State)}`);
    const ports = info.Config.ExposedPorts || {};
    log.debug(`Container ${vmId} exposed ports: ${JSON.stringify(ports)}`);
    const agentPort = Object.keys(ports).length > 0 
      ? Object.keys(ports)[0].split('/')[0] 
      : '8000';
    log.info(`Using agent port: ${agentPort}`);

    // Set environment variables for agent connection back to server
    const envVars = {
      SERVER_URL: serverUrl,
      AGENT_PORT: agentPort,
      AGENT_ID: agentId,
      NODE_ENV: 'production',
    };
    log.debug(`Environment variables to set: ${JSON.stringify(envVars)}`);

    // Stop the container temporarily to reconfigure
    if (info.State.Status === 'running') {
      log.info(`Stopping container ${vmId} to apply new configuration...`);
      await container.stop();
      log.info(`Container ${vmId} stopped`);
    }

    // Update container with new environment variables
    const updateConfig: Record<string, string[]> = {
      Env: Object.entries(envVars).map(([key, value]) => `${key}=${value}`),
    };
    log.debug(`Update config: ${JSON.stringify(updateConfig)}`);

    log.info(`Updating container ${vmId} with new environment variables...`);
    await container.update(updateConfig);
    log.info(`Container ${vmId} updated`);

    // Restart the container
    log.info(`Restarting container ${vmId}...`);
    await container.start();
    log.info(`Container ${vmId} restarted`);

    log.info(`Agent injected into container ${vmId} at http://${containerIp}:${agentPort}`);

    return {
      success: true,
      endpoint: `http://${containerIp}:${agentPort}`,
    };
  } catch (error) {
    const errorMsg = `Error injecting agent into container ${vmId}: ${(error as Error).message}`;
    log.error(errorMsg);
    return {
      success: false,
      error: errorMsg,
    };
  }
}
