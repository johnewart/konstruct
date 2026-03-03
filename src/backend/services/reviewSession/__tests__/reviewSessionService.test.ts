import { describe, it, expect, beforeEach, vi } from 'vitest';
import { reviewSessionService } from '../reviewSessionService';
import { CodeReviewSession, GitDiffFile, CodeReviewComment, AssistantResponse, FinalImplementationPlan } from '../types';
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

describe('ReviewSessionService', () => {
  let service: typeof reviewSessionService;
  let mockRepoPath: string;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Restore original randomUUID
    crypto.randomUUID = originalRandomUUID;
    
    // Initialize service
    service = reviewSessionService;
    mockRepoPath = '/mock/repo/path';
  });

  // Test Category 1: Session Lifecycle
  describe('Session Lifecycle', () => {
    it('should create a session with valid repo path', () => {
      const sessionId = service.createSession(mockRepoPath);
      const session = service.getSession(sessionId);

      expect(session).toBeDefined();
      expect(session?.id).toBeDefined();
      expect(session?.repoPath).toBe(process.cwd());
      expect(session?.diffFiles).toEqual([]);
      expect(session?.comments).toEqual([]);
      expect(session?.responses).toEqual([]);
      expect(session?.createdAt).toBeInstanceOf(Date);
      expect(session?.updatedAt).toBeInstanceOf(Date);
      expect(session?.status).toBe('draft');
      expect(session?.headCommit).toBeDefined();
    });

    it('should return existing session by ID', () => {
      const sessionId = service.createSession(mockRepoPath);
      const session = service.getSession(sessionId);
      const retrievedSession = service.getSession(sessionId);

      expect(retrievedSession).toEqual(session);
    });

    it('should return null for non-existent session', () => {
      const nonExistentId = 'non-existent-id';
      const session = service.getSession(nonExistentId);
      
      expect(session).toBeUndefined();
    });

    it('should delete existing session', () => {
      const sessionId = service.createSession(mockRepoPath);
      const deleted = service.deleteSession(sessionId);

      expect(deleted).toBe(true);
      expect(service.getSession(sessionId)).toBeUndefined();
    });

    it('should return false when deleting non-existent session', () => {
      const nonExistentId = 'non-existent-id';
      const deleted = service.deleteSession(nonExistentId);
      
      expect(deleted).toBe(false);
    });
  });
});