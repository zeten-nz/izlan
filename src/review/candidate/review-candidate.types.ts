/** review-candidate-v1 (TD-122) — a DERIVED READ MODEL. No persistence, no execution, no scoring. */
export const REVIEW_CANDIDATE_VERSION = 'review-candidate-v1';

export const REPEATED_MISTAKE = 'REPEATED_MISTAKE';
export const WEAK_SKILL = 'WEAK_SKILL';
export const REVIEW_DUE = 'REVIEW_DUE';

/** Supported ACTIVE signal types (explicit whitelist, §4). Others (RESOLVED/EXPIRED/unknown) are ignored. */
export const REVIEW_SUPPORTED_SIGNAL_TYPES: readonly string[] = [REPEATED_MISTAKE, WEAK_SKILL, REVIEW_DUE];

/** Canonical serialization order (§21) — acute mistake → scheduled review → general weakness. NOT a score. */
export const SIGNAL_TYPE_ORDER: readonly string[] = [REPEATED_MISTAKE, REVIEW_DUE, WEAK_SKILL];

export type Exposure = 'IN_PROGRESS' | 'COMPLETED';

/** An encountered + currently-visible + in-subject logical Lesson (candidate universe). */
export interface EncounteredVisibleLesson {
  lessonId: string;
  title: string;
  topicId: string;
  exposure: Exposure;
  levelSort: number;
  moduleSort: number;
  topicSort: number;
  lessonSort: number;
}

export interface SkillSignals {
  skillId: string;
  signalTypes: string[]; // ACTIVE supported types for this skill
  directTriggerLessonIds: string[]; // logical Lessons from REPEATED_MISTAKE trigger provenance (already visibility-filtered upstream)
}

export interface SkillMeta {
  id: string;
  name: string;
  sortOrder: number;
}

export interface CandidateFacts {
  skills: SkillMeta[]; // skills that have an ACTIVE supported signal AND belong to the subject
  signalsBySkill: Map<string, SkillSignals>;
  visibleLessons: Map<string, EncounteredVisibleLesson>; // lessonId → lesson
  lessonSkill: Set<string>; // `${skillId}::${lessonId}` — explicit LessonSkill mapping
  activitySkillCurrent: Set<string>; // `${skillId}::${lessonId}` — current published revision ActivitySkill
}

export interface ReviewCandidate {
  lesson: { id: string; title: string; topicId: string };
  exposure: Exposure;
  directTrigger: boolean;
}

export interface ReviewGroup {
  skill: { id: string; name: string };
  signalTypes: string[];
  candidates: ReviewCandidate[];
}

export interface ReviewCandidateResult {
  groups: ReviewGroup[];
  uncoveredSkillIds: string[];
}
