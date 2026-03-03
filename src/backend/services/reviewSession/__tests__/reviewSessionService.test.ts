import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReviewSessionService } from '../reviewSessionService';
import { CodeReviewSession, GitDiffFile, CodeReviewComment, AssistantResponse, FinalImplementationPlan } from '../types';
import { getGitDiff } from '../../git';

// Mock dependencies
vi.mock('../../git', () => ({
  getGitDiff: vi.fn()
}));

// Mock crypto.randomUUID to ensure deterministic test IDs
const originalRandomUUID = crypto.randomUUID;
vi.mock('crypto', () => ({
  randomUUID: vi.fn()
}));

describe('ReviewSessionService', () => {
  let service: ReviewSessionService;
  let mockRepoPath: string;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Restore original randomUUID
    (crypto.randomUUID as any) = originalRandomUUID;
    
    // Initialize service
    service = new ReviewSessionService();
    mockRepoPath = '/mock/repo/path';
  });

  // Test Category 1: Session Lifecycle
  describe('Session Lifecycle', () => {
    it('should create a session with valid repo path', () => {
      const session = service.createSession(mockRepoPath);
      
      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.repoPath).toBe(mockRepoPath);
      expect(session.diffFiles).toEqual([]);
      expect(session.comments).toEqual([]);
      expect(session.responses).toEqual([]);
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.updatedAt).toBeInstanceOf(Date);
      expect(session.status).toBe('draft');
      expect(session.headCommit).toBe('unknown');
    });

    it('should return existing session by ID', () => {
      const session = service.createSession(mockRepoPath);
      const retrievedSession = service.getSession(session.id);
      
      expect(retrievedSession).toEqual(session);
    });

    it('should return null for non-existent session', () => {
      const nonExistentId = 'non-existent-id';
      const session = service.getSession(nonExistentId);
      
      expect(session).toBeNull();
    });

    it('should delete existing session', () => {
      const session = service.createSession(mockRepoPath);
      const deleted = service.deleteSession(session.id);
      
      expect(deleted).toBe(true);
      expect(service.getSession(session.id)).toBeNull();
    });

    it('should return false when deleting non-existent session', () => {
      const nonExistentId = 'non-existent-id';
      const deleted = service.deleteSession(nonExistentId);
      
      expect(deleted).toBe(false);
    });
  });
});