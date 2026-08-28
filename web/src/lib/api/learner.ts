import { apiRequest } from './client';

/**
 * V2 Learner first-run read-model. One server-authoritative call the app routes on, so the client never has to
 * sequence onboarding + placement + roadmap reads itself. Read-only.
 */

export type LearnerStage = 'ONBOARDING' | 'PLACEMENT' | 'TODAY';

export interface LearnerResume {
  sessionId: string;
  pointId: string;
  pointTitle: string;
}

export interface LearnerHome {
  stage: LearnerStage;
  onboardingCompleted: boolean;
  subject: { id: string; title: string } | null;
  resume: LearnerResume | null;
  policyVersion: string;
}

/** GET /api/v2/learner/home — where should this learner land right now (+ any resume action). */
export function fetchLearnerHome(): Promise<LearnerHome> {
  return apiRequest<LearnerHome>('/api/v2/learner/home');
}
