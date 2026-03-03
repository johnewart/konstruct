/**
 * Example usage of the Claude CLI agent wrapper.
 * Run with: CLAUDE_CLI_PATH=/path/to/claude bun run src/agent/claude-cli-agent.example.ts
 * Ensure the Claude CLI is authenticated (e.g. `claude auth` or ANTHROPIC_API_KEY).
 */
import { runAgent, invokeClaudeAgent } from './claude-cli-agent';

const CLAUDE_PATH = process.env.CLAUDE_CLI_PATH ?? '/Users/johnewart/.nvm/versions/node/v22.21.1/bin/claude';

async function main() {
  console.log('Running agent (reply with only "42")...');
  const reply = await runAgent('Reply with only the number 42.', {
    claudePath: CLAUDE_PATH,
    timeoutMs: 60_000,
  });
  console.log('Reply:', JSON.stringify(reply));

  console.log('\nInvoking with full result...');
  const result = await invokeClaudeAgent('What is 1+1? Reply with one word.', {
    claudePath: CLAUDE_PATH,
    timeoutMs: 30_000,
  });
  console.log('stdout:', result.stdout);
  console.log('exitCode:', result.exitCode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
