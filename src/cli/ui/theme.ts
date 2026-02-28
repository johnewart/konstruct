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

import chalk from 'chalk';

// Color themes
export const theme = {
  user: chalk.blue,
  agent: chalk.green,
  tool: chalk.yellow,
  system: chalk.gray,
  status: chalk.cyan,
  prompt: chalk.magenta,
  error: chalk.red,
  info: chalk.white,
  warning: chalk.yellow,
};

// Output formatting
export function formatMessage(
  role: string,
  content: string,
  toolName?: string
): string {
  if (role === 'user') {
    return `${theme.prompt('> ')}${theme.user(content)}`;
  }
  if (role === 'assistant') {
    if (toolName) {
      return `${theme.status('Tool: ')}${theme.tool(toolName)}`;
    }
    return `${theme.agent('Agent: ')}${content}`;
  }
  if (role === 'tool') {
    return `${theme.status('Tool result: ')}${content}`;
  }
  if (role === 'system') {
    return `${theme.system('System: ')}${content}`;
  }
  return content;
}

export function printMessage(
  role: string,
  content: string,
  toolName?: string
): void {
  console.log(formatMessage(role, content, toolName));
}

export function printStatus(message: string): void {
  console.log(theme.status(message));
}

export function printError(message: string): void {
  console.error(theme.error(message));
}

export function printInfo(message: string): void {
  console.log(theme.info(message));
}

export function printWarning(message: string): void {
  console.warn(theme.yellow(message));
}
