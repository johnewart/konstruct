import * as sessionStore from '../../shared/sessionStore';
import { analyzeConversationPattern } from '../supervisor';

// Helper: create a message
function createMessage(
  role: 'user' | 'assistant' | 'tool',
  content?: string,
  toolCalls?: any[]
): sessionStore.ChatMessage {
  return {
    role,
    content: content || '',
    toolCalls: toolCalls || [],
    timestamp: new Date().toISOString(),
  };
}

// Helper: create a tool call
function createToolCall(name: string, args: Record<string, any>): any {
  return {
    id: 'test-id',
    type: 'function',
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

describe('supervisor', () => {
  it('should suggest when reading same file 5+ times with small ranges', () => {
    const messages: sessionStore.ChatMessage[] = [];
    for (let i = 0; i < 5; i++) {
      messages.push(
        createMessage('assistant', '', [
          createToolCall('read_file_region', {
            path: 'src/utils/helpers.ts',
            start_line: 10,
            end_line: 20,
          }),
        ])
      );
    }

    const result = analyzeConversationPattern(messages);

    expect(result.suggestion).toBeDefined();
    expect(result.suggestion).toContain('reading the same file');
    expect(result.suggestion).toContain('src/utils/helpers.ts');
    expect(result.intervention).toBeUndefined();
  });

  it('should suggest when no progress after many steps', () => {
    const messages: sessionStore.ChatMessage[] = [];
    for (let i = 0; i < 20; i++) {
      messages.push(
        createMessage('assistant', '', [
          createToolCall('read_file_region', {
            path: `src/utils/file${i % 5}.ts`,
            start_line: 1,
            end_line: 10,
          }),
        ])
      );
    }

    const result = analyzeConversationPattern(messages);

    expect(result.suggestion).toBeDefined();
    expect(result.suggestion).toContain('getting stuck looking in the same place');
    expect(result.intervention).toBeUndefined();
  });

  it('should intervene when dangerous command detected', () => {
    const messages: sessionStore.ChatMessage[] = [
      createMessage('assistant', 'I will now delete all files with: `rm -rf /`'),
    ];

    const result = analyzeConversationPattern(messages);

    expect(result.intervention).toBe(true);
    expect(result.suggestion).toBeUndefined();
  });

  it('should suggest when file not found error repeated 3+ times', () => {
    const messages: sessionStore.ChatMessage[] = [];
    for (let i = 0; i < 3; i++) {
      messages.push(
        createMessage('assistant', 'Error: file not found: src/missing/file.ts')
      );
    }

    const result = analyzeConversationPattern(messages);

    expect(result.suggestion).toBeDefined();
    expect(result.suggestion).toContain('repeatedly looking for a file that doesn\'t exist');
    expect(result.intervention).toBeUndefined();
  });

  it('should not trigger when normal conversation with file changes', () => {
    const messages: sessionStore.ChatMessage[] = [
      createMessage('assistant', '', [
        createToolCall('read_file_region', {
          path: 'src/utils/helpers.ts',
          start_line: 1,
          end_line: 50,
        }),
      ]),
      createMessage('assistant', '', [
        createToolCall('grep', {
          pattern: 'function',
          path: 'src/utils/helpers.ts',
        }),
      ]),
      createMessage('assistant', '', [
        createToolCall('write_file', {
          path: 'src/utils/new-file.ts',
          content: 'console.log("Hello");',
        }),
      ]),
    ];

    const result = analyzeConversationPattern(messages);

    expect(result.suggestion).toBeUndefined();
    expect(result.intervention).toBeUndefined();
  });

  it('should not trigger on first 4 messages (below threshold of 5)', () => {
    const messages: sessionStore.ChatMessage[] = [];
    for (let i = 0; i < 4; i++) {
      messages.push(
        createMessage('assistant', '', [
          createToolCall('read_file_region', {
            path: 'src/utils/helpers.ts',
            start_line: 10,
            end_line: 20,
          }),
        ])
      );
    }

    const result = analyzeConversationPattern(messages);

    expect(result.suggestion).toBeUndefined();
    expect(result.intervention).toBeUndefined();
  });
});
