import * as sessionStore from '../shared/sessionStore.ts';

export interface AnalysisResult {
  suggestion?: string;
  intervention?: boolean;
}

export function analyzeConversationPattern(messages: sessionStore.ChatMessage[]): AnalysisResult {
  // Track file reads, writes, tool usage, and progress
  const fileReads = messages.filter(m => m.toolCalls?.some(tc => tc.function?.name === 'read_file_region'));
  const writes = messages.filter(m => m.toolCalls?.some(tc => tc.function?.name === 'write_file'));
  const toolUsage = messages.flatMap(m => m.toolCalls || []).map(tc => tc.function?.name);

  // Count repeated file reads on same path
  const repeatedReads = countRepeatedFileReads(fileReads);
  if (repeatedReads.count >= 5 && repeatedReads.samePath) {
    return {
      suggestion: `You're reading the same file (${repeatedReads.path}) ${repeatedReads.count} times with small ranges. Try reading a larger chunk (e.g., lines 1-200) to reduce round trips.`
    };
  }

  // Detect no progress after many steps
  if (writes.length === 0 && messages.length > 15) {
    const last5 = messages.slice(-5);
    if (last5.every(m => m.toolCalls?.some(tc => ['grep', 'read_file_region', 'list_files'].includes(tc.function?.name || '')))) {
      return {
        suggestion: "You're getting stuck looking in the same place without making progress. Consider broadening your search or asking the user for clarification."
      };
    }
  }

  // Detect dangerous commands
  const dangerousCommands = ['rm -rf', 'chmod 777', 'mv /', 'dd if=', 'echo "foo" > /etc'];
  const hasDangerous = messages.some(m => 
    m.content?.includes('`') && dangerousCommands.some(cmd => m.content?.includes(cmd))
  );
  if (hasDangerous) {
    return {
      intervention: true
    };
  }

  // Detect hallucinated file existence
  const fileNotFoundCount = messages.filter(m => 
    m.content?.includes('file not found') || m.content?.includes('No such file')
  ).length;
  if (fileNotFoundCount >= 3 && fileNotFoundCount === messages.slice(-5).filter(m => m.content?.includes('file not found')).length) {
    return {
      suggestion: "You're repeatedly looking for a file that doesn't exist. Verify the correct path or check if the file was renamed or deleted."
    };
  }

  return {};
}

function countRepeatedFileReads(fileReads: ChatMessage[]) {
  const paths: Record<string, { count: number, lines: string[] }> = {};
  for (const msg of fileReads) {
    for (const tc of msg.toolCalls || []) {
      if (tc.function?.name === 'read_file_region' && tc.function.arguments) {
        try {
          const args = JSON.parse(tc.function.arguments);
          const path = args.path;
          const range = `${args.start_line}-${args.end_line}`;
          if (!paths[path]) paths[path] = { count: 0, lines: [] };
          paths[path].count++;
          paths[path].lines.push(range);
        } catch (e) {}
      }
    }
  }

  const mostRepeated = Object.entries(paths).reduce((acc, [path, data]) => 
    data.count > acc.count ? { path, count: data.count, samePath: true } : acc, 
    { path: '', count: 0, samePath: false }
  );

  return mostRepeated.count >= 5 ? mostRepeated : { path: '', count: 0, samePath: false };
}