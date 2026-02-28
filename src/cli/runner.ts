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

import ora from 'ora';
import chalk from 'chalk';
import { theme, printMessage, printInfo, printStatus, printError, printWarning } from './ui/theme';

export class AgentRunner {
  private sessionId: string | null = null;
  private trpc: any;
  private spinner: any | null = null;
  private selectedProviderId: string | null = null;

  constructor(trpcClient: any) {
    this.trpc = trpcClient;
  }

  public async createSession(title: string = 'CLI Chat'): Promise<void> {
    const result = await this.trpc.sessions.create.mutate({ title });
    this.sessionId = result.id;
    printInfo(`Created session: ${result.id}`);
    printInfo(`Title: ${result.title}`);
    printStatus('Type /help for commands, or start chatting!');
    console.log('');
  }

  public async loadSession(sessionId: string): Promise<void> {
    this.sessionId = sessionId;
    const session = await this.trpc.sessions.get.query({ id: sessionId });
    printInfo(`Loaded session: ${session.id}`);
    printInfo(`Title: ${session.title}`);
    printStatus(`Messages: ${session.messages.length}`);
    console.log('');
  }

  public async sendMessage(content: string): Promise<void> {
    if (!this.sessionId) {
      throw new Error('No active session. Create or load a session first.');
    }

    this.showSpinner('Agent is thinking...');
    
    try {
      await this.trpc.chat.sendMessage.mutate({
        sessionId: this.sessionId,
        content,
        modeId: 'implementation',
        providerId: this.selectedProviderId || 'openai',
      });

      // Poll for new messages
      await this.pollForMessages();
    } finally {
      this.hideSpinner();
    }
  }

  public async pollForMessages(): Promise<void> {
    if (!this.sessionId) return;

    // Poll for new messages (max 10 seconds)
    const maxAttempts = 20;
    const interval = 500;
    let attempts = 0;

    while (attempts < maxAttempts) {
      const session = await this.trpc.sessions.get.query({ id: this.sessionId });
      const messages = session.messages.filter((m: any) => m.role !== 'system');

      if (messages.length > 0) {
        // Display new messages
        for (const msg of messages) {
          this.showMessage(msg);
        }
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, interval));
      attempts++;
    }
  }

  public async listSessions(): Promise<void> {
    const sessions = await this.trpc.sessions.list.query();
    if (sessions.length === 0) {
      printInfo('No sessions found.');
    } else {
      printStatus('Sessions:');
      sessions.forEach((s: any) => {
        console.log(`  ${s.id} - ${s.title}`);
      });
    }
  }

  public async clearScreen(): Promise<void> {
    console.clear();
  }

  public async exit(): Promise<void> {
    printStatus('Goodbye!');
    process.exit(0);
  }

  public async listProviders(): Promise<void> {
    try {
      const result = await this.trpc.chat.listProviders.query();
      printStatus(`Providers (${result.providers.length} found):`);
      result.providers.forEach((p: any) => {
        const status = p.configured ? '✓' : '✗';
        const urlInfo = p.url ? ` @ ${p.url}` : '';
        console.log(`  ${status} ${p.id} - ${p.name} (default: ${p.defaultModel})${urlInfo}`);
      });
      printInfo(`Default provider: ${result.defaultProviderId}`);
    } catch (err) {
      console.error(printError(`Failed to list providers: ${err}`));
    }
  }

  public async selectProvider(providerId: string): Promise<void> {
    try {
      const result = await this.trpc.chat.listProviders.query();
      const provider = result.providers.find((p: any) => p.id === providerId);
      
      if (!provider) {
        printError(`Provider "${providerId}" not found.`);
        this.listProviders();
        return;
      }
      
      if (!provider.configured) {
        console.warn(printWarning(`Provider "${providerId}" is not configured.`));
      }
      
      this.selectedProviderId = providerId;
      printStatus(`Selected provider: ${provider.name}`);
      printInfo(`Model: ${provider.defaultModel}`);
    } catch (err) {
      console.error(printError(`Failed to select provider: ${err}`));
    }
  }

  public async showHelp(): Promise<void> {
    console.log('');
    printStatus('Available commands:');
    console.log('  /help      - Show this help message');
    console.log('  /clear     - Clear the screen');
    console.log('  /list      - List all sessions');
    console.log('  /session   - Show current session info');
    console.log('  /providers - List available providers');
    console.log('  /provider  - Select a provider (e.g., /provider openai)');
    console.log('  /exit      - Exit the CLI');
    console.log('');
    console.log('Type your message to chat with the agent!');
    console.log('');
  }

  public async showSession(): Promise<void> {
    if (!this.sessionId) {
      printInfo('No active session.');
      return;
    }
    const session = await this.trpc.sessions.get.query({ id: this.sessionId });
    printStatus(`Session: ${session.id}`);
    printInfo(`Title: ${session.title}`);
    printInfo(`Messages: ${session.messages.length}`);
    printInfo(`Created: ${session.createdAt}`);
    printInfo(`Updated: ${session.updatedAt}`);
    
    if (this.selectedProviderId) {
      printInfo(`Current provider: ${this.selectedProviderId}`);
    } else {
      printInfo(`Current provider: openai (default)`);
    }
  }

  private showMessage(msg: any): void {
    if (msg.role === 'assistant' && msg.toolCalls?.length > 0) {
      for (const tc of msg.toolCalls) {
        console.log(chalk.yellow(`Tool: ${tc.function.name}`));
      }
    }
    if (msg.content) {
      printMessage(msg.role, msg.content);
    }
  }

  private showSpinner(text: string): void {
    this.spinner = ora({
      text,
      spinner: 'dots',
      color: 'cyan',
    }).start();
  }

  private hideSpinner(): void {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
  }
}
