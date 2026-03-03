import { CodeReviewSession, AssistantResponse } from '../models/codeReviewModels';

export class ResponseHandler {
  static buildPrompt(session: CodeReviewSession): string {
    const formattedComments = session.comments
      .filter(c => !c.isResolved)
      .map(c => `Comment on ${c.fileId}:${c.lineNumber}: "${c.text}"`)
      .join('\n');

    const formattedResponses = session.responses
      .map(r => `Response ${r.id} (${r.type}): ${r.content}`)
      .join('\n');

    const formattedDiff = session.diffFiles
      .map(file => {
        return `--- ${file.path} ---\n${file.hunks
          .map(hunk => hunk.header + '\n' + hunk.lines.map(l => l.content).join('\n'))
          .join('\n')}`;
      })
      .join('\n\n');

    return `
You are assisting with a code review. The user has reviewed recent git changes and left comments on specific lines.

You are given:
1. The full git diff of changed files
2. A list of user comments on specific lines
3. Your previous responses (if any)

Your task:
- Respond to each comment clearly
- If a comment points to a bug, mistake, or improvement, propose a fix as a unified diff hunk
- If clarification is needed, ask a precise question
- Do not suggest changes unrelated to the comments

Current comments:
${formattedComments}

Previous responses:
${formattedResponses}

Full diff:
${formattedDiff}

Respond with:
- A clear response to each comment
- Optional: one or more suggested changes in unified diff format
- Do NOT suggest changes outside the scope of the comments
    `.trim();
  }

  static parseLLMResponse(raw: string): AssistantResponse[] {
    // Split into responses by comment reference or line breaks
    // For simplicity, assume one response per comment or overall response
    // In future: use structured output (JSON) from LLM

    // Simple heuristic: if line starts with "Suggested change", extract hunk
    const lines = raw.split('\n');
    const responses: AssistantResponse[] = [];
    let currentResponse: AssistantResponse | null = null;

    for (const line of lines) {
      if (line.startsWith('Suggested change to')) {
        // Extract path and hunk
        const pathMatch = line.match(/Suggested change to (.+):/);
        if (pathMatch && currentResponse) {
          const path = pathMatch[1].trim();
          // Collect hunk lines until next suggestion or end
          const hunkLines: string[] = [];
          let nextLine = lines.shift();
          while (nextLine && (nextLine.startsWith('+') || nextLine.startsWith('-') || nextLine.startsWith('@@'))) {
            hunkLines.push(nextLine);
            nextLine = lines.shift();
          }
          currentResponse.suggestedChanges = currentResponse.suggestedChanges || [];
          currentResponse.suggestedChanges.push({
            path,
            hunk: hunkLines.join('\n'),
            explanation: line,
          });
        }
      } else if (line.startsWith('Response to') || line.trim().length > 5) {
        if (!currentResponse) {
          currentResponse = {
            id: crypto.randomUUID(),
            commentIds: [],
            type: 'suggestion',
            content: line,
            createdAt: new Date(),
          };
          responses.push(currentResponse);
        } else {
          currentResponse.content += '\n' + line;
        }
      }
    }

    // Fallback: if no structured response, treat entire output as one
    if (responses.length === 0 && raw.trim().length > 0) {
      return [{
        id: crypto.randomUUID(),
        commentIds: [],
        type: 'suggestion',
        content: raw,
        createdAt: new Date(),
      }];
    }

    return responses;
  }
}