#!/usr/bin/env node
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
 * CLI Agent Interface
 * 
 * A simple console-based interface for interacting with the agent.
 * 
 * Usage:
 *   bun run src/cli/index.ts
 * 
 * Environment Variables:
 *   TRPC_BASE_URL - The base URL for the tRPC API (default: http://localhost:3000)
 * 
 * Commands:
 *   /help      - Show help message
 *   /clear     - Clear screen
 *   /list      - List sessions
 *   /session   - Show current session info
 *   /providers - List available providers
 *   /provider  - Select a provider (e.g., /provider openai)
 *   /exit      - Exit CLI
 */

import { createCliTrpcClient } from './client';
import { CliInput } from './ui/input';
import { AgentRunner } from './runner';
import { printInfo, printStatus, printError, printWarning } from './ui/theme';

const TRPC_BASE_URL = process.env.TRPC_BASE_URL || 'http://localhost:3000';
const AGENT_ENDPOINT = process.env.AGENT_ENDPOINT || '/agent-stream';

async function main(): Promise<void> {
  console.clear();
  console.log(printStatus('=== Konstruct Agent CLI ==='));
  console.log(printInfo('Connecting to server...'));
  console.log('');

  // Create tRPC client
  const trpc = createCliTrpcClient(TRPC_BASE_URL);

  // Create runner
  const runner = new AgentRunner(trpc);

  // Create input handler
  const input = new CliInput();

  // Check if we can connect
  try {
    await trpc.chat.listModes.query();
    console.log(printInfo('Connected to server!'));
  } catch (err) {
    console.error(
      printError(`Failed to connect to server at ${TRPC_BASE_URL}`)
    );
    console.error(printError('Please make sure the server is running.'));
    input.close();
    process.exit(1);
  }

  console.log('');

  // Create a new session
  try {
    await runner.createSession('CLI Session');
  } catch (err) {
    console.error(printError(`Failed to create session: ${err}`));
    input.close();
    process.exit(1);
  }

  // Main input loop
  while (true) {
    const result = await input.start();

    if (result.isExit) {
      await runner.exit();
      break;
    }

    if (result.command) {
      switch (result.command.toLowerCase()) {
        case 'help':
          await runner.showHelp();
          break;
        case 'clear':
          await runner.clearScreen();
          break;
        case 'list':
          await runner.listSessions();
          break;
        case 'session':
          await runner.showSession();
          break;
        case 'providers':
          await runner.listProviders();
          break;
        case 'provider':
          // Extract provider id from the rest of the line
          const providerId = result.args?.trim();
          if (providerId) {
            await runner.selectProvider(providerId);
          } else {
            console.log(printError('Usage: /provider <provider_id>'));
            console.log(printInfo('Available providers:'));
            await runner.listProviders();
          }
          break;
        case 'exit':
          await runner.exit();
          break;
        default:
          console.log(printError(`Unknown command: ${result.command}`));
          await runner.showHelp();
      }
    } else if (result.text) {
      try {
        await runner.sendMessage(result.text);
      } catch (err) {
        console.error(printError(`Error: ${err}`));
      }
    }
  }

  input.close();
}

main().catch((err) => {
  console.error(printError(`Fatal error: ${err}`));
  process.exit(1);
});
