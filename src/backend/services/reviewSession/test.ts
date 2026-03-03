import { ReviewSessionManager } from './reviewSession';
import { CodeReviewSession } from '../models/codeReviewModels';

// Test the ReviewSessionManager functionality
async function testReviewSessionManager() {
  const manager = new ReviewSessionManager();
  
  // Create a session
  const sessionId = manager.createSession();
  console.log('Created session:', sessionId);
  
  // Get the session
  const session = manager.getSession(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }
  
  // Add a comment
  const comment = manager.addComment(sessionId, 'src/utils/config.ts', 5, 'This should use const instead of var');
  console.log('Added comment:', comment);
  
  // Load the diff
  const diffLoaded = await manager.loadDiff(sessionId);
  console.log('Diff loaded:', diffLoaded);
  
  // Trigger assistant response
  const responses = await manager.triggerAssistantResponse(sessionId);
  console.log('Assistant responses:', responses);
  
  // Resolve the comment
  const resolved = manager.resolveComment(sessionId, comment.id);
  console.log('Comment resolved:', resolved);
  
  // Mark as ready for plan
  const ready = manager.markAsReadyForPlan(sessionId);
  console.log('Marked as ready for plan:', ready);
  
  // Generate final plan
  const plan = manager.generateFinalPlan(sessionId);
  console.log('Generated final plan:', plan);
}

// Run the test
// testReviewSessionManager().catch(console.error);