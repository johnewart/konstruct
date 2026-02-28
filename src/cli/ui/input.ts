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

import * as readline from 'readline';

export interface InputResult {
  command?: string;
  args?: string;
  text?: string;
  isExit: boolean;
}

const PROMPT = '> ';

export class CliInput {
  private rl: readline.Interface;
  private resolve?: (result: InputResult) => void;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: PROMPT,
    });

    this.rl.on('line', (line) => {
      this.handleInput(line.trim());
    });

    this.rl.on('SIGINT', () => {
      process.exit(0);
    });

    this.rl.on('close', () => {
      process.exit(0);
    });
  }

  public async start(): Promise<InputResult> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.rl.prompt();
    });
  }

  private handleInput(line: string): void {
    if (!this.resolve) return;

    const trimmed = line.trim();

    // Check for commands
    if (trimmed.startsWith('/')) {
      const parts = trimmed.slice(1).split(/\s+/);
      const command = parts[0].toLowerCase();
      const args = parts.slice(1).join(' ');
      
      if (command === 'exit') {
        this.resolve({ isExit: true });
      } else {
        this.resolve({ command, args, isExit: false });
      }
      this.rl.prompt();
    } else if (trimmed.toLowerCase() === 'exit') {
      this.resolve({ isExit: true });
    } else {
      this.resolve({ text: trimmed, isExit: false });
      this.rl.prompt();
    }
  }

  public close(): void {
    this.rl.close();
  }
}
