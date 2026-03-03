import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiffLoader } from '../diffLoader';
import { CodeReviewSession } from '../types';
import { getGitDiff } from '../../../git';

// Mock dependencies
vi.mock('../../../git', () => ({
  getGitDiff: vi.fn()
}));

describe('DiffLoader', () => {
  let session: CodeReviewSession;
  
  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Initialize mock session
    session = {
      id: 'session-123',
      repoPath: '/mock/repo/path',
      headCommit: 'unknown',
      diffFiles: [],
      comments: [],
      responses: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'draft'
    };
  });

  it('should load diff from valid repository', async () => {
    // Arrange
    const mockDiffFiles: any[] = [
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
    ];
    
    vi.mocked(getGitDiff).mockResolvedValue(mockDiffFiles);
    
    // Act
    const result = await DiffLoader.loadForSession(session);
    
    // Assert - DiffLoader.loadForSession returns diff files, it does not mutate session
    expect(getGitDiff).toHaveBeenCalledWith(session.repoPath);
    expect(result).toEqual(mockDiffFiles);
  });

  it('should throw error when no repo path in session', async () => {
    // Arrange
    const sessionWithoutRepoPath = {
      ...session,
      repoPath: undefined
    } as any;
    
    // Act & Assert
    await expect(DiffLoader.loadForSession(sessionWithoutRepoPath)).rejects.toThrow('No repo path in session');
  });

  it('should handle empty diff (no changes)', async () => {
    // Arrange
    vi.mocked(getGitDiff).mockResolvedValue([]);
    
    // Act
    const result = await DiffLoader.loadForSession(session);
    
    // Assert
    expect(getGitDiff).toHaveBeenCalledWith(session.repoPath);
    expect(result).toEqual([]);
    expect(session.diffFiles).toEqual([]);
  });

  it('should handle repository path that is not a git repository', async () => {
    // Arrange
    vi.mocked(getGitDiff).mockRejectedValue(new Error('Not a git repository'));
    
    // Act & Assert
    await expect(DiffLoader.loadForSession(session)).rejects.toThrow();
  });
});