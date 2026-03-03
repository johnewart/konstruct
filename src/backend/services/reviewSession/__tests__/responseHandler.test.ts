import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ResponseHandler } from '../responseHandler';
import { CodeReviewSession, CodeReviewComment, AssistantResponse, GitDiffFile } from '../types';

// Mock crypto.randomUUID to ensure deterministic test IDs
const mockRandomUUID = vi.fn();
vi.mock('crypto', () => ({
  randomUUID: mockRandomUUID
}));

describe('ResponseHandler', () => {
  let session: CodeReviewSession;
  
  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Initialize mock session with diff files
    session = {
      id: 'session-123',
      repoPath: '/mock/repo/path',
      headCommit: 'unknown',
      diffFiles: [
        {
          path: 'src/utils/config.ts',
          hunks: [
            {
              header: '@@ -1,5 +1,5 @@',
              lines: [
                { content: '-var config = {', type: 'removed' },
                { content: '+const config = {', type: 'added' },
                { content: '   timeout: 5000', type: 'unchanged' },
                { content: ' };', type: 'unchanged' }
              ]
            }
          ]
        }
      ],
      comments: [],
      responses: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'draft'
    };
  });

  describe('buildPrompt', () => {
    it('should build prompt with no comments', () => {
      // Arrange & Act
      const prompt = ResponseHandler.buildPrompt(session);
      
      // Assert
      expect(prompt).toContain('You are assisting with a code review');
      expect(prompt).toContain('Current comments:');
      expect(prompt).toContain('Previous responses:');
      expect(prompt).toContain('Full diff:');
      
      // Ensure no comments are included
      expect(prompt).not.toContain('Comment on');
      expect(prompt).not.toContain('Response');
    });

    it('should build prompt with resolved comments (filtered out)', () => {
      // Arrange
      mockRandomUUID.mockReturnValue('comment-1');
      const comment = {
        id: 'comment-1',
        fileId: 'src/utils/config.ts',
        lineNumber: 2,
        text: 'This should use const instead of var',
        createdAt: new Date(),
        isResolved: true
      } as CodeReviewComment;
      session.comments = [comment];
      
      // Act
      const prompt = ResponseHandler.buildPrompt(session);
      
      // Assert
      expect(prompt).toContain('Current comments:');
      expect(prompt).not.toContain('This should use const instead of var');
    });

    it('should build prompt with multiple unresolved comments', () => {
      // Arrange
      mockRandomUUID
        .mockReturnValueOnce('comment-1')
        .mockReturnValueOnce('comment-2');
      
      session.comments = [
        {
          id: 'comment-1',
          fileId: 'src/utils/config.ts',
          lineNumber: 2,
          text: 'This should use const instead of var',
          createdAt: new Date(),
          isResolved: false
        },
        {
          id: 'comment-2',
          fileId: 'src/api/client.ts',
          lineNumber: 11,
          text: 'Add error handling for network failures',
          createdAt: new Date(),
          isResolved: false
        }
      ];
      
      // Act
      const prompt = ResponseHandler.buildPrompt(session);
      
      // Assert
      expect(prompt).toContain('Comment on src/utils/config.ts:2: "This should use const instead of var"');
      expect(prompt).toContain('Comment on src/api/client.ts:11: "Add error handling for network failures"');
    });

    it('should build prompt with existing assistant responses', () => {
      // Arrange
      session.responses = [
        {
          id: 'response-1',
          commentIds: [],
          type: 'suggestion',
          content: 'Consider using async/await for better error handling',
          createdAt: new Date()
        }
      ];
      
      // Act
      const prompt = ResponseHandler.buildPrompt(session);
      
      // Assert
      expect(prompt).toContain('Response response-1 (suggestion): Consider using async/await for better error handling');
    });

    it('should build prompt with empty diff', () => {
      // Arrange
      session.diffFiles = [];
      
      // Act
      const prompt = ResponseHandler.buildPrompt(session);
      
      // Assert
      expect(prompt).toContain('Full diff:');
      expect(prompt).not.toContain('---');
    });
  });

  describe('parseLLMResponse', () => {
    it('should parse valid structured response with suggested change', () => {
      // Arrange
      const rawResponse = `Response to Comment on src/utils/config.ts:2: "This should use const instead of var":
I agree, using const is better for constants.

Suggested change to src/utils/config.ts:
---
@@ -1,5 +1,5 @@
-var config = {
+const config = {
   timeout: 5000
 }
---

Response to Comment on src/api/client.ts:11: "Add error handling for network failures":
Good point. Here's the fix:

Suggested change to src/api/client.ts:
---
@@ -15,3 +15,8 @@
 function fetchData(url) {
-  return fetch(url);
+  return fetch(url)
+    .then(response => {
+      if (!response.ok) {
+        throw new Error('Network response was not ok');
+      }
+      return response.json();
+    });
 }
---
`;
      
      // Act
      const responses = ResponseHandler.parseLLMResponse(rawResponse);
      
      // Assert
      expect(responses).toHaveLength(2);
      
      // First response
      expect(responses[0].type).toBe('suggestion');
      expect(responses[0].content).toContain('I agree, using const is better for constants');
      expect(responses[0].suggestedChanges).toHaveLength(1);
      expect(responses[0].suggestedChanges[0].path).toBe('src/utils/config.ts');
      expect(responses[0].suggestedChanges[0].hunk).toContain('@@ -1,5 +1,5 @@');
      
      // Second response
      expect(responses[1].type).toBe('suggestion');
      expect(responses[1].content).toContain('Good point. Here\'s the fix');
      expect(responses[1].suggestedChanges).toHaveLength(1);
      expect(responses[1].suggestedChanges[0].path).toBe('src/api/client.ts');
      expect(responses[1].suggestedChanges[0].hunk).toContain('@@ -15,3 +15,8 @@');
    });

    it('should parse response with multiple suggested changes in one response', () => {
      // Arrange
      const rawResponse = `Response to Comment on src/utils/config.ts:2: "This should use const instead of var":
I agree, using const is better for constants.

Suggested change to src/utils/config.ts:
---
@@ -1,5 +1,5 @@
-var config = {
+const config = {
   timeout: 5000
 }
---

Suggested change to src/utils/config.ts:
---
@@ -10,3 +10,3 @@
-  timeout: 5000
+  timeout: 10000
---
`;
      
      // Act
      const responses = ResponseHandler.parseLLMResponse(rawResponse);
      
      // Assert
      expect(responses).toHaveLength(1);
      expect(responses[0].suggestedChanges).toHaveLength(2);
      expect(responses[0].suggestedChanges[0].path).toBe('src/utils/config.ts');
      expect(responses[0].suggestedChanges[1].path).toBe('src/utils/config.ts');
    });

    it('should parse response with "Response to" format', () => {
      // Arrange
      const rawResponse = `Response to Comment on src/utils/config.ts:2: "This should use const instead of var":
I agree with your suggestion. Using const is indeed better for constants.

Response to Comment on src/api/client.ts:11: "Add error handling for network failures":
You're right, we should handle network failures. Let's add a retry mechanism.`;
      
      // Act
      const responses = ResponseHandler.parseLLMResponse(rawResponse);
      
      // Assert
      expect(responses).toHaveLength(2);
      expect(responses[0].content).toContain('I agree with your suggestion');
      expect(responses[1].content).toContain('You\'re right');
      expect(responses[0].suggestedChanges).toBeUndefined();
      expect(responses[1].suggestedChanges).toBeUndefined();
    });

    it('should handle malformed LLM output with no structure', () => {
      // Arrange
      const rawResponse = 'This is just a simple response without any structure or formatting.';
      
      // Act
      const responses = ResponseHandler.parseLLMResponse(rawResponse);
      
      // Assert
      expect(responses).toHaveLength(1);
      expect(responses[0].type).toBe('suggestion');
      expect(responses[0].content).toBe(rawResponse);
      expect(responses[0].suggestedChanges).toBeUndefined();
    });

    it('should handle empty response', () => {
      // Arrange
      const rawResponse = '';
      
      // Act
      const responses = ResponseHandler.parseLLMResponse(rawResponse);
      
      // Assert
      expect(responses).toHaveLength(0);
    });

    it('should handle very long response', () => {
      // Arrange
      const longText = 'a'.repeat(10000);
      const rawResponse = `Response to Comment on src/utils/config.ts:2: "This should use const instead of var":
${longText}`;
      
      // Act
      const responses = ResponseHandler.parseLLMResponse(rawResponse);
      
      // Assert
      expect(responses).toHaveLength(1);
      // The content should contain the long text, but we need to account for the prefix
      expect(responses[0].content).toContain(longText);
      // Verify the length is at least the long text length
      expect(responses[0].content.length).toBeGreaterThanOrEqual(10000);
    });
  });
});