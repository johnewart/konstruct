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
    // Handle empty response
    if (!raw || raw.trim().length === 0) {
      return [];
    }

    const responses: AssistantResponse[] = [];
    
    // Split the raw response into sections based on 'Response to' and 'Suggested change to'
    // We'll use a state machine approach to parse
    const lines = raw.split('\n');
    let currentResponse: AssistantResponse | null = null;
    let currentSuggestedChange: SuggestedChange | null = null;
    let inHunk = false;
    let hunkLines: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check for 'Suggested change to' pattern
      if (line.startsWith('Suggested change to')) {
        // If we were already collecting a hunk, save it
        if (currentSuggestedChange && hunkLines.length > 0) {
          currentSuggestedChange.hunk = hunkLines.join('\n');
          currentResponse.suggestedChanges = currentResponse.suggestedChanges || [];
          currentResponse.suggestedChanges.push(currentSuggestedChange);
          currentSuggestedChange = null;
          hunkLines = [];
        }
        
        // Extract the file path
        const pathMatch = line.match(/Suggested change to (.+):/);
        if (pathMatch) {
          const path = pathMatch[1].trim();
          
          // Create a new suggested change
          currentSuggestedChange = {
            path,
            hunk: '',
            explanation: line
          };
          
          // Look for the next line which should be '---'
          if (i + 1 < lines.length && lines[i + 1].trim() === '---') {
            i++; // Skip the '---' line
            inHunk = true;
          }
        }
      }
      
      // Check for 'Response to' pattern
      else if (line.startsWith('Response to')) {
        // If we were collecting a hunk, save it before starting a new response
        if (currentSuggestedChange && hunkLines.length > 0) {
          currentSuggestedChange.hunk = hunkLines.join('\n');
          currentResponse.suggestedChanges = currentResponse.suggestedChanges || [];
          currentResponse.suggestedChanges.push(currentSuggestedChange);
          currentSuggestedChange = null;
          hunkLines = [];
        }
        
        // Start a new response
        currentResponse = {
          id: crypto.randomUUID(),
          commentIds: [],
          type: 'suggestion',
          content: line,
          createdAt: new Date()
        };
        responses.push(currentResponse);
        inHunk = false;
      }
      
      // Handle hunk lines (diff format)
      else if (inHunk) {
        // End of hunk when we hit another '---' or a new section
        if (line.trim() === '---') {
          // Save the hunk
          currentSuggestedChange.hunk = hunkLines.join('\n');
          currentResponse.suggestedChanges = currentResponse.suggestedChanges || [];
          currentResponse.suggestedChanges.push(currentSuggestedChange);
          currentSuggestedChange = null;
          hunkLines = [];
          inHunk = false;
        } else {
          hunkLines.push(line);
        }
      }
      
      // Handle continuation of response text
      else if (currentResponse) {
        // Skip empty lines if this is the first line of content
        if (currentResponse.content === line && line.trim().length === 0) {
          continue;
        }
        
        // Add line to response content
        currentResponse.content += '\n' + line;
      }
    }
    
    // Handle any remaining hunk
    if (currentSuggestedChange && hunkLines.length > 0) {
      currentSuggestedChange.hunk = hunkLines.join('\n');
      currentResponse.suggestedChanges = currentResponse.suggestedChanges || [];
      currentResponse.suggestedChanges.push(currentSuggestedChange);
    }
    
    // If no responses were created but we have content, create one
    if (responses.length === 0 && raw.trim().length > 0) {
      responses.push({
        id: crypto.randomUUID(),
        commentIds: [],
        type: 'suggestion',
        content: raw,
        createdAt: new Date()
      });
    }
    
    return responses;
  }
}