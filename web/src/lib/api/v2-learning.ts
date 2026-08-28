import { apiRequest } from './client';
import type { LearnerActivity, ActivityAnswer } from './types';

/**
 * V2 Learning Core API wrappers (roadmap generation/projection + teaching session lifecycle). Server is the sole
 * authority for scoring, evidence and mastery — the client only renders backend-authoritative state and submits
 * answers with a per-attempt clientRequestId for idempotency. answerKey / correctness are never sent or received.
 */

export interface V2LearningOutcome {
  canDo?: string[];
}

export interface V2RoadmapPoint {
  roadmapPointId: string;
  pointKey: string;
  title: string;
  learningOutcome: V2LearningOutcome | null;
  estimatedEffortMin: number | null;
  sortOrder: number;
  availability: 'LOCKED' | 'AVAILABLE' | 'IN_PROGRESS' | 'CONTENT_UNAVAILABLE';
  acquisition: string | null; // null | LEARNED | VALIDATED
  attention: 'NONE' | 'REVIEW_DUE' | 'REPAIR_REQUIRED';
  attentionReason: 'REPEATED_MISTAKE' | 'PERSISTENT_WEAKNESS' | 'RETENTION_DUE' | null; // why (learner-language in UI)
  attentionSkill: { id: string; name: string } | null; // the skill driving the attention
  learned: boolean;
  validated: boolean; // acquired via placement evidence (acknowledged, skippable) — distinct from LEARNED
  activeSessionId: string | null;
}

export interface V2Roadmap {
  generation: { id: string; subjectId: string; trackId: string; generationNo: number; generatedAt: string } | null;
  points: V2RoadmapPoint[];
}

/** A projected teaching activity: the learner-facing activity union + V2 orchestration/progress metadata. */
export type TeachingActivity = LearnerActivity & {
  role: string;
  kind: 'OBJECTIVE' | 'VIEW_ONLY' | 'UNSUPPORTED';
  attempted: boolean;
  lastResult: { isCorrect: boolean; deterministicScore: number } | null;
};

export interface TeachingStage {
  id: string;
  position: number;
  stageType: string;
  title: string;
  description: string;
  activities: TeachingActivity[];
}

export interface TeachingMasteryStatus {
  requiredSkillCount: number;
  outcome: string | null;
  satisfied: boolean;
  learned: boolean;
  canCheck: boolean;
  gates: unknown[] | null;
}

export interface TeachingSessionView {
  id: string;
  roadmapPointId: string;
  roadmapPointRevisionId: string;
  blueprintRevisionId: string;
  title: string;
  learningOutcome: V2LearningOutcome | null;
  status: string;
  stages: TeachingStage[];
  mastery: TeachingMasteryStatus;
}

export interface TeachingAttemptView {
  attemptId: string;
  activityId: string;
  attemptNo: number;
  isCorrect: boolean;
  deterministicScore: number;
  remediation: string | null;
}

export interface MasteryCheckView {
  outcome: string;
  satisfied: boolean;
  learned: boolean;
  acquisitionId: string | null;
  gates: unknown[];
}

export function fetchV2Roadmap(subjectId: string): Promise<V2Roadmap> {
  return apiRequest(`/api/v2/roadmap/subjects/${subjectId}`);
}

/** The single most useful next learning action, decided from current evidence (repair > review > continue). */
export interface V2Focus {
  action: 'REPAIR' | 'REVIEW' | 'CONTINUE' | 'DONE';
  policyVersion: string;
  point: { roadmapPointId: string; pointKey: string; title: string; activeSessionId: string | null } | null;
  skill: { id: string; name: string } | null;
  reason: 'REPEATED_MISTAKE' | 'PERSISTENT_WEAKNESS' | 'RETENTION_DUE' | null;
}

export function fetchV2Focus(subjectId: string): Promise<V2Focus> {
  return apiRequest(`/api/v2/roadmap/subjects/${subjectId}/focus`);
}

/** Start (or resume) a review session for one skill of an acquired point. Returns the reused review session. */
export function startPointReview(pointId: string, skillId: string): Promise<{ id: string }> {
  return apiRequest(`/api/v2/roadmap-points/${pointId}/review/skills/${skillId}/start`, { method: 'POST' });
}

export function startTeachingSession(pointId: string): Promise<TeachingSessionView> {
  return apiRequest(`/api/v2/roadmap-points/${pointId}/teaching-session/start`, { method: 'POST' });
}

export function fetchTeachingSession(sessionId: string): Promise<TeachingSessionView> {
  return apiRequest(`/api/v2/teaching-sessions/${sessionId}`);
}

export function submitTeachingActivity(sessionId: string, activityId: string, answer: ActivityAnswer): Promise<TeachingAttemptView> {
  return apiRequest(`/api/v2/teaching-sessions/${sessionId}/activities/${activityId}/attempts`, {
    method: 'POST',
    body: { clientRequestId: crypto.randomUUID(), answer },
  });
}

export function runMasteryCheck(sessionId: string): Promise<MasteryCheckView> {
  return apiRequest(`/api/v2/teaching-sessions/${sessionId}/mastery-check`, { method: 'POST' });
}
