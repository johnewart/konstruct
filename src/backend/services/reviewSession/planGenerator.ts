import { CodeReviewSession, FinalImplementationPlan } from '../models/codeReviewModels';
import { ReviewSessionManager, reviewSessionManager } from '../reviewSession';

export class PlanGenerator {
  static generateFinalPlan(sessionId: string, sessionManager: ReviewSessionManager): FinalImplementationPlan {
    return sessionManager.generateFinalPlan(sessionId);
  }
}

// Export a singleton instance
export const planGenerator = {
  generateFinalPlan: (sessionId: string) =>
    PlanGenerator.generateFinalPlan(sessionId, reviewSessionManager),
};