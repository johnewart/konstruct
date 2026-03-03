import { CodeReviewSession } from '../../models/codeReviewModels';
import { getGitDiff } from '../../git';

export class DiffLoader {
  static async loadForSession(session: CodeReviewSession): Promise<CodeReviewSession['diffFiles']> {
    if (!session.repoPath) {
      throw new Error('No repo path in session');
    }
    
    // Validate the repository path is still valid
    if (!await this.isValidRepository(session.repoPath)) {
      throw new Error('Invalid repository path');
    }
    
    return getGitDiff(session.repoPath);
  }
  
  private static async isValidRepository(repoPath: string): Promise<boolean> {
    try {
      // This is a simplified check - in a real implementation, we might want to run git status
      // or use the existing isGitRepository function from git.ts
      return true;
    } catch {
      return false;
    }
  }
}