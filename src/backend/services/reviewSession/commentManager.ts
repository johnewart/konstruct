import { CodeReviewComment, CodeReviewSession } from '../../models/codeReviewModels';
import { ReviewSessionManager, reviewSessionManager } from '../reviewSession';

// Create a singleton instance
export const commentManager = {
  addComment: ReviewSessionManager.prototype.addComment.bind(reviewSessionManager),
  updateComment: ReviewSessionManager.prototype.updateComment.bind(reviewSessionManager),
  deleteComment: ReviewSessionManager.prototype.deleteComment.bind(reviewSessionManager),
  resolveComment: ReviewSessionManager.prototype.resolveComment.bind(reviewSessionManager)
};