import { describe, it, expect, beforeEach, vi } from 'vitest';
import { reviewSessionService } from '../reviewSessionService';
import { CodeReviewSession, CodeReviewComment, AssistantResponse } from '../types';

// Mock git so createSession does not require a real repo
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

describe('State Transitions', () => {
  let service: typeof reviewSessionService;
  
  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Restore original randomUUID
    crypto.randomUUID = originalRandomUUID;
    
    // Initialize service
    service = reviewSessionService;
  });

  describe('markAsReadyForPlan', () => {
    it('should mark session as ready-for-plan successfully', () => {
      // Arrange
      const sessionId = service.createSession('/mock/repo/path');

      // Act
      const result = service.markAsReadyForPlan(sessionId);

      // Assert
      expect(result).toBe(true);
      expect(service.getSession(sessionId)?.status).toBe('ready-for-plan');
    });

    it('should return false when session does not exist', () => {
      // Arrange & Act
      const result = service.markAsReadyForPlan('non-existent-id');
      
      // Assert
      expect(result).toBe(false);
    });
  });

  describe('isReadyForPlan', () => {
    it('should return true when status is ready-for-plan', () => {
      // Arrange
      const sessionId = service.createSession('/mock/repo/path');
      service.markAsReadyForPlan(sessionId);

      // Act
      const result = service.isReadyForPlan(sessionId);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when status is draft', () => {
      // Arrange
      const sessionId = service.createSession('/mock/repo/path');

      // Act
      const result = service.isReadyForPlan(sessionId);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when session does not exist', () => {
      // Arrange & Act
      const result = service.isReadyForPlan('non-existent-id');
      
      // Assert
      expect(result).toBe(false);
    });
  });

  describe('triggerAssistantResponse', () => {
    it('should trigger assistant response with valid session', async () => {
      // Arrange
      const sessionId = service.createSession('/mock/repo/path');

      // Mock the agent-worker call
      const originalCallAgentWorker = (service as any)['callAgentWorker'];
      (service as any)['callAgentWorker'] = async () => 'Response to Comment: I agree with your feedback.';

      // Act
      const responses = await service.triggerAssistantResponse(sessionId);

      // Assert
      expect(responses).toHaveLength(1);
      expect(responses[0].type).toBe('suggestion');
      expect(responses[0].content).toBe('Response to Comment: I agree with your feedback.');
      expect(service.getSession(sessionId)?.responses).toHaveLength(1);

      // Restore original method
      (service as any)['callAgentWorker'] = originalCallAgentWorker;
    });

    it('should throw error when session does not exist', async () => {
      // Arrange & Act & Assert
      await expect(service.triggerAssistantResponse('non-existent-id')).rejects.toThrow('Session not found');
    });
  });
});