"/*
 * Copyright 2026 John Ewart <john@johnewart.net>
 *
 * Licensed under the Apache License, Version 2.0 (the \"License\");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an \"AS IS\" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { GitDiffFile, CodeReviewComment, AssistantResponse, CodeReviewSession, FinalImplementationPlan, SuggestedChange } from '../models/codeReviewModels';
import { getGitDiff, getGitRepoPath, isGitRepository } from '../git';
import { v4 as uuidv4 } from 'uuid';
import { ResponseHandler } from './responseHandler';
import { DiffLoader } from './diffLoader';

/**
 * Manages the state of a code review session
 */
export class ReviewSessionManager {
  private sessions: Map<string, CodeReviewSession> = new Map();

  /**
   * Create a new review session for the given repository path
   */
  public createSession(repoPath: string = '.'): string {
    // Validate repository
    if (!isGitRepository(repoPath)) {
      throw new Error('Not a git repository');
    }

    // Get the actual repository path
    const actualRepoPath = getGitRepoPath(repoPath) || repoPath;

    // Get current HEAD commit
    const headCommit = this.getCurrentCommit(actualRepoPath);
    
    // Get git diff of all changed files
    const diffFiles = getGitDiff(actualRepoPath);

    // Create new session
    const session: CodeReviewSession = {
      id: uuidv4(),
      repoPath: actualRepoPath,
      headCommit,
      diffFiles,
      comments: [],
      responses: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'draft',
    };

    this.sessions.set(session.id, session);
    return session.id;
  }

  /**
   * Get a session by ID
   */
  public getSession(id: string): CodeReviewSession | undefined {
    return this.sessions.get(id);
  }

  /**
   * Add a comment to a session
   */
  public addComment(sessionId: string, fileId: string, lineNumber: number, text: string): CodeReviewComment {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const comment: CodeReviewComment = {
      id: uuidv4(),
      fileId,
      lineNumber,
      text,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    session.comments.push(comment);
    session.updatedAt = new Date();
    
    return comment;
  }

  /**
   * Update a comment in a session
   */
  public updateComment(sessionId: string, commentId: string, text: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    const comment = session.comments.find(c => c.id === commentId);
    if (!comment) {
      return false;
    }

    comment.text = text;
    comment.updatedAt = new Date();
    session.updatedAt = new Date();
    return true;
  }

  /**
   * Delete a comment from a session
   */
  public deleteComment(sessionId: string, commentId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    const initialLength = session.comments.length;
    session.comments = session.comments.filter(c => c.id !== commentId);
    if (session.comments.length < initialLength) {
      session.updatedAt = new Date();
      return true;
    }
    return false;
  }

  /**
   * Resolve a comment in a session
   */
  public resolveComment(sessionId: string, commentId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    const comment = session.comments.find(c => c.id === commentId);
    if (!comment) {
      return false;
    }

    comment.isResolved = true;
    session.updatedAt = new Date();
    return true;
  }

  /**
   * Add a response to a session
   */
  public addResponse(sessionId: string, commentIds: string[], type: 'suggestion' | 'question' | 'clarification', content: string, suggestedChanges?: SuggestedChange[]): AssistantResponse {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const response: AssistantResponse = {
      id: uuidv4(),
      commentIds,
      type,
      content,
      suggestedChanges,
      createdAt: new Date(),
    };

    session.responses.push(response);
    session.updatedAt = new Date();
    
    return response;
  }

  /**
   * Update session status
   */
  public updateSessionStatus(sessionId: string, status: 'draft' | 'reviewing' | 'ready-for-plan' | 'completed'): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    session.status = status;
    session.updatedAt = new Date();
  }

  /**
   * Mark a session as ready for plan generation
   */
  public markAsReadyForPlan(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.status = 'ready-for-plan';
    session.updatedAt = new Date();
    return true;
  }

  /**
   * Check if a session is ready for plan generation
   */
  public isReadyForPlan(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return session?.status === 'ready-for-plan' || false;
  }

  /**
   * Load or reload the git diff for a session
   */
  public async loadDiff(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    try {
      session.diffFiles = await DiffLoader.loadForSession(session);
      session.updatedAt = new Date();
      return true;
    } catch (error) {
      console.error('Failed to load git diff:', error);
      return false;
    }
  }

  /**
   * Trigger the assistant to respond to comments in a session
   */
  public async triggerAssistantResponse(sessionId: string): Promise<AssistantResponse[]> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    // Build prompt for the LLM
    const prompt = ResponseHandler.buildPrompt(session);

    // Call the agent worker to get a response
    // This is a placeholder - in a real implementation, we would use the WebSocket connection
    // to communicate with the agent-worker process
    
    // For now, we'll simulate the response with a placeholder
    // In production, this would use the agent-worker API
    const rawResponse = await this.callAgentWorker(prompt);

    // Parse the LLM response into structured AssistantResponse objects
    const responses = ResponseHandler.parseLLMResponse(rawResponse);

    // Attach comment IDs to responses
    // In a real implementation, we would link responses to specific comments via LLM inference
    // For now: attach to all unresolved comments
    const unresolvedComments = session.comments.filter(c => !c.isResolved);
    responses.forEach(r => {
      r.commentIds = unresolvedComments.map(c => c.id);
      r.createdAt = new Date();
    });

    // Add responses to session
    session.responses.push(...responses);
    session.updatedAt = new Date();

    return responses;
  }

  /**
   * Generate a final implementation plan from a completed review session
   */
  public generateFinalPlan(sessionId: string): FinalImplementationPlan {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    // Extract all approved changes from responses
    const changes: FinalImplementationPlan['changes'] = [];
    
    // Collect all suggested changes from assistant responses
    for (const response of session.responses) {
      if (response.suggestedChanges) {
        for (const suggestedChange of response.suggestedChanges) {
          // Find all comments that led to this change
          const relatedComments = session.comments.filter(comment => 
            response.commentIds.includes(comment.id)
          ).map(comment => comment.id);

          changes.push({
            path: suggestedChange.path,
            description: this.extractChangeDescription(suggestedChange.hunk),
            diffHunk: suggestedChange.hunk,
            relatedComments,
          });
        }
      }
    }

    // Create a title and summary based on the changes
    const title = this.generateTitle(changes);
    const summary = this.generateSummary(changes);
    const rationale = this.generateRationale(session);

    return {
      title,
      summary,
      changes,
      rationale,
    };
  }

  /**
   * Extract a description from a unified diff hunk
   */
  private extractChangeDescription(hunk: string): string {
    // Look for the first added line
    const lines = hunk.split('\n');
    const addedLine = lines.find(line => line.startsWith('+'));
    
    if (addedLine) {
      // Remove the + and trim whitespace
      return addedLine.substring(1).trim();
    }
    
    return 'Change to code';
  }

  /**
   * Generate a title for the final plan
   */
  private generateTitle(changes: FinalImplementationPlan['changes']): string {
    if (changes.length === 0) return 'No changes needed';
    
    // Look for common patterns in the changes
    const hasRefactor = changes.some(change => 
      change.description.toLowerCase().includes('refactor') ||
      change.description.toLowerCase().includes('rename')
    );
    
    if (hasRefactor) return 'Refactor codebase';
    
    const hasFix = changes.some(change => 
      change.description.toLowerCase().includes('fix') ||
      change.description.toLowerCase().includes('bug')
    );
    
    if (hasFix) return 'Fix bugs and issues';
    
    const hasFeature = changes.some(change => 
      change.description.toLowerCase().includes('add') ||
      change.description.toLowerCase().includes('new')
    );
    
    if (hasFeature) return 'Add new features';
    
    return 'Update code';
  }

  /**
   * Generate a summary for the final plan
   */
  private generateSummary(changes: FinalImplementationPlan['changes']): string {
    if (changes.length === 0) return 'No changes were made in this review.';
    
    const fileCount = new Set(changes.map(c => c.path)).size;
    
    if (changes.length === 1) {
      return `Made 1 change to ${changes[0].path} based on review feedback.`;
    }
    
    return `Made ${changes.length} changes across ${fileCount} files based on review feedback.`;
  }

  /**
   * Generate rationale for the final plan
   */
  private generateRationale(session: CodeReviewSession): string {
    let rationale = 'These changes address all identified issues and improvements from the code review.';
    
    if (session.responses.length === 0) {
      rationale += ' No specific changes were suggested by the assistant.';
    } else {
      // Add information about the review process
      const suggestionCount = session.responses.filter(r => r.type === 'suggestion').length;
      const questionCount = session.responses.filter(r => r.type === 'question').length;
      
      if (suggestionCount > 0) {
        rationale += ` The review generated ${suggestionCount} suggested improvements.`;
      }
      
      if (questionCount > 0) {
        rationale += ` The review also included ${questionCount} questions to clarify requirements.`;
      }
      
      rationale += ' All changes are directly related to the comments made during the review process.';
    }
    
    return rationale;
  }

  /**
   * Get current HEAD commit hash
   */
  private getCurrentCommit(repoPath: string): string | null {
    try {
      const result = execSync('git rev-parse HEAD', {
        cwd: repoPath,
        encoding: 'utf-8',
      });
      return result.toString().trim();
    } catch {
      return null;
    }
  }

  /**
   * Call the agent worker to get a response from the LLM
   */
  private async callAgentWorker(prompt: string): Promise<string> {
    // This is a placeholder implementation
    // In a real system, this would use the agent-worker WebSocket API
    
    // For now, we'll simulate a response
    // In production, we would:
    // 1. Connect to the agent-worker service
    // 2. Send the prompt via WebSocket
    // 3. Wait for the response
    // 4. Return the raw LLM response
    
    // Simulated response based on the example in the plan
    return "I noticed the code uses var instead of let/const. Consider using let for mutable variables and const for constants.\n\nSuggested change to src/utils/config.ts:\n---\n@@ -5,7 +5,7 @@\n var config = {\n-  timeout: 5000\n+  timeout: 10000\n }\n---";
  }
}

// Create a singleton instance
export const reviewSessionManager = new ReviewSessionManager();
"