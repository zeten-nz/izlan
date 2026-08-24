import { apiRequest } from './client';
import type { LearningIntent, OnboardingStatus, OnboardingSubject, OnboardingTrack } from './types';

/** GET /api/onboarding/status — { completed, canComplete, missing[] }. */
export function fetchOnboardingStatus(): Promise<OnboardingStatus> {
  return apiRequest<OnboardingStatus>('/api/onboarding/status');
}

/** GET /api/onboarding/subjects — PUBLISHED, learner-visible subjects only. */
export function fetchOnboardingSubjects(): Promise<OnboardingSubject[]> {
  return apiRequest<OnboardingSubject[]>('/api/onboarding/subjects');
}

/** GET /api/onboarding/subjects/:subjectId/tracks — PUBLISHED tracks for the subject. */
export function fetchOnboardingTracks(subjectId: string): Promise<OnboardingTrack[]> {
  return apiRequest<OnboardingTrack[]>(`/api/onboarding/subjects/${subjectId}/tracks`);
}

/** GET /api/onboarding/learning-intents — own intents (track may be null = subject-only). */
export function fetchLearningIntents(): Promise<LearningIntent[]> {
  return apiRequest<LearningIntent[]>('/api/onboarding/learning-intents');
}

/** PUT /api/onboarding/learning-intent — upsert on (subject); omit trackId for the resumable subject-only state. */
export function saveLearningIntent(subjectId: string, trackId?: string): Promise<LearningIntent[]> {
  return apiRequest<LearningIntent[]>('/api/onboarding/learning-intent', {
    method: 'PUT',
    body: trackId ? { subjectId, trackId } : { subjectId },
  });
}

/** POST /api/onboarding/complete — only when canComplete; { completed, completedAt }. */
export function completeOnboarding(): Promise<{ completed: boolean; completedAt: string }> {
  return apiRequest<{ completed: boolean; completedAt: string }>('/api/onboarding/complete', { method: 'POST' });
}
