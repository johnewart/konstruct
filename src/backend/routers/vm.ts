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

import { z } from 'zod';
import { router, publicProcedure } from '../trpc/trpc';
import {
  provisionDocker,
  startDockerContainer,
  stopDockerContainer,
  deleteDockerContainer,
  listDockerVMs,
  DockerConfig,
  deployAgentToContainer,
  injectAgentIntoContainer,
  getAgentEndpoint as getVmDockerAgentEndpoint,
} from '../services/vmDocker';
import { createTunnel } from '../services/tunnel';
import { createLogger } from '../../shared/logger';

const log = createLogger('vm-router');

// Input schemas
const configSchema = z.object({
  provider: z.string().min(1),
  config: z.record(z.unknown()),
});

const vmIdSchema = z.object({ vmId: z.string().min(1) });

// Result types
interface ProvisionResult {
  success: boolean;
  vmId?: string;
  provider?: string;
  endpoint?: string;
  tunnelUrl?: string;
  containerId?: string;
  agentEndpoint?: string;
  error?: string;
}

interface ListResult {
  success: boolean;
  vms?: Array<{
    id: string;
    name: string;
    provider: string;
    status: 'pending' | 'running' | 'stopped' | 'error' | 'exited';
    createdAt: string;
    endpoint?: string;
    ports?: Record<string, number>;
    containerId?: string;
    error?: string;
    agentStatus?: 'connected' | 'disconnected' | 'connecting' | 'unknown';
  }>;
  error?: string;
}

interface OperationResult {
  success: boolean;
  error?: string;
}

export const vmRouter = router({
  /**
   * Provision a new VM instance
   */
  provision: publicProcedure
    .input(configSchema)
    .mutation(async ({ input, ctx }): Promise<ProvisionResult> => {
      const { provider, config } = input;

      try {
        // Create tunnel for agent communication
        const agentId = `agent-${Date.now()}`;
        const tunnelResult = createTunnel(agentId, provider);
        
        if (!tunnelResult.success) {
          return {
            success: false,
            error: `Failed to create tunnel: ${tunnelResult.error}`,
          };
        }
        
        log.info(`Created tunnel ${tunnelResult.tunnelId} for agent ${agentId}`);

        // Provider-specific provisioning logic
        switch (provider) {
          case 'docker': {
            const dockerConfig = config as unknown as DockerConfig;
            
            // Get server URL from context or environment
            // Use non-null assertion since we always provide a default value
            const serverUrl = (process.env.SERVER_URL || 'http://localhost:3001') as string;
            
            log.info(`Provisioning Docker container with server URL: ${serverUrl}`);
            
            // Build env object with proper types
            const envVars: Record<string, string> = {
              ...(dockerConfig.env || {}),
              AGENT_TUNNEL_ID: tunnelResult.tunnelId!,
              SERVER_URL: serverUrl,
              AGENT_PORT: '8000',
              AGENT_ID: agentId,
            };
            
            log.debug(`Environment variables: ${JSON.stringify(envVars)}`);
            
            const result = await provisionDocker({
              image: dockerConfig.image || 'ubuntu:latest',
              name: dockerConfig.name || `konstruct-${agentId}`,
              ports: dockerConfig.ports,
              env: envVars,
            });

            log.info(`Container provisioning result: success=${result.success}, containerId=${result.containerId}`);

            // If container was created successfully, deploy agent to it
            if (result.success && result.containerId) {
              log.info(`Deploying agent to container ${result.containerId}...`);
              const deployResult = await deployAgentToContainer(
                result.containerId,
                serverUrl,
                agentId
              );
              
              log.info(`Agent deployment result: success=${deployResult.success}, endpoint=${deployResult.endpoint}`);
              
              if (!deployResult.success) {
                log.warn(`Failed to deploy agent to container: ${deployResult.error}`);
              }
            }

            return {
              success: result.success,
              vmId: result.vmId,
              provider: result.provider,
              endpoint: result.endpoint,
              tunnelUrl: result.agentEndpoint ? `${result.agentEndpoint}/tunnel/${tunnelResult.tunnelId}` : undefined,
              containerId: result.containerId,
              agentEndpoint: result.agentEndpoint,
              error: result.error,
            };
          }

          case 'aws':
            return {
              success: false,
              provider,
              error: 'AWS EC2 provisioning not yet implemented',
            };

          case 'runpod':
            return {
              success: false,
              provider,
              error: 'RunPod provisioning not yet implemented',
            };

          default:
            return {
              success: false,
              provider,
              error: `Provider "${provider}" is not supported`,
            };
        }
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message || 'Failed to provision VM',
        };
      }
    }),

  /**
   * Start a stopped VM instance
   */
  start: publicProcedure
    .input(vmIdSchema)
    .mutation(async ({ input }): Promise<OperationResult> => {
      const { vmId } = input;

      try {
        // For Docker, use the container ID
        const result = await startDockerContainer(vmId);
        
        if (!result.success) {
          return {
            success: false,
            error: result.error,
          };
        }

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message || `Failed to start VM ${vmId}`,
        };
      }
    }),

  /**
   * Stop a running VM instance
   */
  stop: publicProcedure
    .input(vmIdSchema)
    .mutation(async ({ input }): Promise<OperationResult> => {
      const { vmId } = input;

      try {
        // For Docker, use the container ID
        const result = await stopDockerContainer(vmId);
        
        if (!result.success) {
          return {
            success: false,
            error: result.error,
          };
        }

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message || `Failed to stop VM ${vmId}`,
        };
      }
    }),

  /**
   * Delete a VM instance
   */
  delete: publicProcedure
    .input(vmIdSchema)
    .mutation(async ({ input }): Promise<OperationResult> => {
      const { vmId } = input;

      try {
        // For Docker, use the container ID
        await deleteDockerContainer(vmId);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message || `Failed to delete VM ${vmId}`,
        };
      }
    }),

  /**
   * List all active VM instances
   */
  list: publicProcedure.query(async (): Promise<ListResult> => {
    try {
      const vms = await listDockerVMs();

      return {
        success: true,
        vms: vms.map((vm) => ({
          id: vm.id,
          name: vm.name,
          provider: vm.provider,
          status: vm.status,
          createdAt: vm.createdAt,
          endpoint: vm.endpoint,
          ports: vm.ports,
          containerId: vm.containerId,
          error: vm.error,
          agentStatus: 'unknown' as const,
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message || 'Failed to list VMs',
      };
    }
  }),

  /**
   * Inject agent into an existing container
   */
  injectAgent: publicProcedure
    .input(vmIdSchema)
    .mutation(async ({ input, ctx }): Promise<ProvisionResult> => {
      const { vmId } = input;
      
      log.info(`Injecting agent into container ${vmId}`);

      try {
        // Get server URL from environment
        const serverUrl = (process.env.SERVER_URL || 'http://localhost:3001') as string;
        const agentId = `agent-${Date.now()}`;
        
        log.info(`Server URL: ${serverUrl}, Agent ID: ${agentId}`);
        
        // Create tunnel for agent communication
        const tunnelResult = createTunnel(agentId, 'docker');
        
        if (!tunnelResult.success) {
          const errorMsg = `Failed to create tunnel: ${tunnelResult.error}`;
          log.error(errorMsg);
          return {
            success: false,
            error: errorMsg,
          };
        }
        
        log.info(`Created tunnel ${tunnelResult.tunnelId} for agent ${agentId}`);

        // Inject agent into container
        log.info(`Calling injectAgentIntoContainer for ${vmId}...`);
        const result = await injectAgentIntoContainer(
          vmId,
          serverUrl,
          agentId
        );
        log.info(`injectAgentIntoContainer result: success=${result.success}, endpoint=${result.endpoint}`);

        return {
          success: result.success,
          vmId,
          provider: 'docker',
          endpoint: result.endpoint,
          tunnelUrl: result.endpoint ? `${result.endpoint}/tunnel/${tunnelResult.tunnelId}` : undefined,
          containerId: vmId,
          agentEndpoint: result.endpoint,
          error: result.error,
        };
      } catch (error) {
        return {
          success: false,
          provider: 'docker',
          error: (error as Error).message || 'Failed to inject agent',
        };
      }
    }),
});

// Export types for use in frontend
export type { ProvisionResult, ListResult, OperationResult };