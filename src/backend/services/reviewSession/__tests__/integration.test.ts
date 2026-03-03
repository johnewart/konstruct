import { describe, it, expect, beforeEach, vi } from 'vitest';
import { reviewSessionService } from '../reviewSessionService';
import { CodeReviewSession, CodeReviewComment, AssistantResponse, FinalImplementationPlan } from '../types';
import { getGitDiff } from '../../../git';

// Mock dependencies - partial mock so isGitRepository etc. exist
vi.mock('../../../git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../git')>();
  return {
    ...actual,
    getGitDiff: vi.fn(() => []),
    isGitRepository: vi.fn(() => true),
    getGitRepoPath: vi.fn(() => process.cwd()),
  };
});

// Mock crypto.randomUUID to ensure deterministic test IDs
const originalRandomUUID = crypto.randomUUID;
vi.mock('crypto', () => ({
  randomUUID: vi.fn()
}));

describe('Integration: Full Workflow', () => {
  const service = reviewSessionService;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Restore original randomUUID
    crypto.randomUUID = originalRandomUUID;

    // Mock getGitDiff with sample diff (sync)
    vi.mocked(getGitDiff).mockReturnValue([
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
    ]);

    // Mock agent-worker call
    (service as any)['callAgentWorker'] = async () => `Response to Comment on src/utils/config.ts:2: "This should use const instead of var":
I agree, using const is better for constants.

Suggested change to src/utils/config.ts:
---
@@ -1,5 +1,5 @@
-var config = {
+const config = {
   timeout: 5000
 }
---`;
  });

  it('should complete the full workflow: create → load diff → add comment → trigger assistant → resolve comment → generate plan', async () => {
    // Arrange
    const repoPath = '/mock/repo/path';

    // Step 1: Create session (returns session id)
    const sessionId = service.createSession(repoPath);
    const session = service.getSession(sessionId);
    expect(session?.status).toBe('draft');

    // Step 2: Load diff
    const diffLoaded = await service.loadDiff(sessionId);
    expect(diffLoaded).toBe(true);
    expect(service.getSession(sessionId)?.diffFiles).toHaveLength(1);

    // Step 3: Add comment
    const comment = service.addComment(sessionId, 'src/utils/config.ts', 1, 'This should use const instead of var');
    expect(comment).toBeDefined();
    expect(service.getSession(sessionId)?.comments).toHaveLength(1);
    
    // Step 4: Trigger assistant response
    const responses = await service.triggerAssistantResponse(sessionId);
    expect(responses).toHaveLength(1);
    expect(responses[0].type).toBe('suggestion');
    expect(service.getSession(sessionId)?.responses).toHaveLength(1);

    // Step 5: Resolve comment
    const resolved = service.resolveComment(sessionId, comment.id);
    expect(resolved).toBe(true);
    expect(service.getSession(sessionId)?.comments[0].isResolved).toBe(true);

    // Step 6: Mark as ready for plan
    const ready = service.markAsReadyForPlan(sessionId);
    expect(ready).toBe(true);
    expect(service.getSession(sessionId)?.status).toBe('ready-for-plan');

    // Step 7: Generate final plan
    const plan = service.generateFinalPlan(sessionId);
    expect(plan).toBeDefined();
    expect(plan?.title).toBeDefined();
    expect(plan?.changes?.length).toBeGreaterThanOrEqual(1);
    expect(plan?.changes?.[0].path).toBe('src/utils/config.ts');
    expect(plan?.changes?.[0].relatedComments).toContain(comment.id);
  });

  it('should handle workflow with multiple assistant responses', async () => {
    // Arrange
    const repoPath = '/mock/repo/path';

    // Create session
    const sessionId = service.createSession(repoPath);

    // Load diff
    await service.loadDiff(sessionId);

    // Add first comment
    const comment1 = service.addComment(sessionId, 'src/utils/config.ts', 1, 'This should use const instead of var');

    // Add second comment (same file, line 1 is only valid line in mock hunk; use 1 for both)
    const comment2 = service.addComment(sessionId, 'src/utils/config.ts', 1, 'Increase timeout to 10000ms');
    
    // Mock multiple assistant responses
    (service['callAgentWorker'] as any) = async () => `Response to Comment on src/utils/config.ts:2: "This should use const instead of var":
I agree, using const is better for constants.

Suggested change to src/utils/config.ts:
---
@@ -1,5 +1,5 @@
-var config = {
+const config = {
   timeout: 5000
 }
---

Response to Comment on src/utils/config.ts:4: "Increase timeout to 10000ms":
Good suggestion. Here's the change:

Suggested change to src/utils/config.ts:
---
@@ -3,3 +3,3 @@
   timeout: 5000
 }
+  timeout: 10000
 }
---`;
    
    // Trigger assistant response
    const responses = await service.triggerAssistantResponse(sessionId);
    expect(responses).toHaveLength(2);

    // Mark as ready for plan
    service.markAsReadyForPlan(sessionId);

    // Generate final plan
    const plan = service.generateFinalPlan(sessionId);
    expect(plan).toBeDefined();
    expect(plan?.changes?.length).toBeGreaterThanOrEqual(1);
    const relatedIds = plan?.changes?.flatMap((c) => c.relatedComments ?? []) ?? [];
    expect(relatedIds).toContain(comment1.id);
    expect(relatedIds).toContain(comment2.id);
  });

  it('should handle comments added after assistant responses', async () => {
    // Arrange
    const repoPath = '/mock/repo/path';

    // Create session
    const sessionId = service.createSession(repoPath);

    // Load diff
    await service.loadDiff(sessionId);

    // Trigger assistant response first (before any comments)
    (service as any)['callAgentWorker'] = async () => 'No suggestions needed.';
    await service.triggerAssistantResponse(sessionId);

    // Add comment after assistant response
    const comment = service.addComment(sessionId, 'src/utils/config.ts', 1, 'This should use const instead of var');
    
    // Trigger assistant response again
    (service['callAgentWorker'] as any) = async () => `Response to Comment on src/utils/config.ts:2: "This should use const instead of var":
I agree, using const is better for constants.

Suggested change to src/utils/config.ts:
---
@@ -1,5 +1,5 @@
-var config = {
+const config = {
   timeout: 5000
 }
---`;
    const responses = await service.triggerAssistantResponse(sessionId);
    expect(responses).toHaveLength(1);

    // Mark as ready for plan
    service.markAsReadyForPlan(sessionId);

    // Generate final plan
    const plan = service.generateFinalPlan(sessionId);
    expect(plan).toBeDefined();
    expect(plan?.changes).toHaveLength(1);
    expect(plan?.changes[0].relatedComments).toEqual([comment.id]);
  });
});