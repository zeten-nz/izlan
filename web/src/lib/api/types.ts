/**
 * Types mirroring the Izlan backend content-authoring + auth contract (runtime-authoritative audit).
 * Field names match the backend presenters EXACTLY — do not paraphrase. `updatedAt` is always the OCC token.
 */

export type ContainerStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type LessonStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type RevisionStatus = 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED';
export type SkillStatus = 'ACTIVE' | 'ARCHIVED';
export type ContentSource = 'HUMAN' | 'AI_GENERATED' | 'AI_ASSISTED';

export type ActivityType =
  | 'TEXT'
  | 'EXPLANATION'
  | 'IMAGE'
  | 'AUDIO'
  | 'EXAMPLE'
  | 'MINI_QUESTION'
  | 'PRACTICE'
  | 'SPEAKING'
  | 'WRITING'
  | 'LISTENING'
  | 'AI_INTERACTION'
  | 'MASTERY_TEST'
  | 'VIDEO';

// ── Auth ──
export interface AuthTokenResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user?: AuthUser;
}
export interface AuthUser {
  id: string;
  onboardingCompleted: boolean;
}
export interface OtpRequestResponse {
  challengeId: string;
  expiresIn: number;
  resendAfter: number;
}

// ── CMS capability/session (Phase 2.2C) ──
export interface CmsCapabilities {
  author: boolean;
  publish: boolean;
  subjectManage: boolean;
}
export interface CmsSession {
  userId: string;
  capabilities: CmsCapabilities;
}

// ── Presenters ──
export interface Subject {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: ContainerStatus;
  sortOrder: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}
/** Authoritative outcome of a safe subject removal. `reason` is a stable code the UI localizes (never raw FK detail). */
export interface SubjectDeletionResult {
  outcome: 'DELETED' | 'ARCHIVED' | 'BLOCKED';
  subjectId: string;
  title: string;
  reason: 'LEARNER_HISTORY' | 'PUBLISHED_CONTENT' | 'RESIDUAL_CONTENT' | null;
}
export interface Track {
  id: string;
  subjectId: string;
  slug: string;
  title: string;
  description: string | null;
  status: ContainerStatus;
  sortOrder: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface Level {
  id: string;
  trackId: string;
  code: string;
  title: string;
  status: ContainerStatus;
  sortOrder: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface Module {
  id: string;
  levelId: string;
  title: string;
  description: string | null;
  status: ContainerStatus;
  sortOrder: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface Topic {
  id: string;
  moduleId: string;
  title: string;
  description: string | null;
  status: ContainerStatus;
  sortOrder: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface Lesson {
  id: string;
  topicId: string;
  contentKey: string;
  slug: string | null;
  status: LessonStatus;
  sortOrder: number;
  publishedRevisionId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface Revision {
  id: string;
  lessonId: string;
  version: number;
  title: string;
  description: string | null;
  estimatedDurationMin: number | null;
  status: RevisionStatus;
  createdBy: string | null;
  updatedBy: string | null;
  reviewedBy: string | null;
  publishedBy: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface Skill {
  id: string;
  subjectId: string;
  name: string;
  code: string | null;
  description: string | null;
  status: SkillStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
export interface Activity {
  id: string;
  lessonRevisionId: string;
  type: ActivityType;
  position: number;
  estimatedDurationMin: number | null;
  payload: unknown; // full authoring payload (may contain answerKey — authoring only, never rendered as preview)
  source: ContentSource;
  aiMetadata: unknown | null;
  createdAt: string;
  updatedAt: string;
}
export interface MappedSkill {
  skillId: string;
  name: string;
  code: string | null;
  sortOrder: number;
  status: SkillStatus;
}
export interface PrerequisiteLesson {
  prerequisiteLessonId: string;
  contentKey: string;
  slug: string | null;
  status: LessonStatus;
  sortOrder: number;
  topicId: string;
}
export interface Assignment {
  id: string;
  userId: string;
  subjectId: string;
  assignedAt: string;
  assignedBy: string | null;
}

// ── Mutation response envelopes that carry OCC tokens ──
export interface ActivityMutationResult {
  activity: Activity;
  revisionUpdatedAt: string;
}
export interface ActivityDeleteResult {
  deleted: true;
  revisionUpdatedAt: string;
}
export interface ReorderResult {
  revisionId: string;
  orderedActivityIds: string[];
  revisionUpdatedAt: string;
}
export interface LessonTokenResult {
  lessonUpdatedAt: string;
}
export interface RevisionTokenResult {
  revisionUpdatedAt: string;
}
export interface HierarchyPublishResult {
  id: string;
  status: 'PUBLISHED';
  updatedAt: string;
}
export interface PublicationView {
  lesson: { id: string; status: LessonStatus; publishedRevisionId: string | null };
  revision: Revision;
}
export interface ArchiveView {
  lessonId: string;
  status: LessonStatus;
  publishedRevisionId: string | null;
  updatedAt: string;
}
export interface AssignmentRemoveResult {
  removed: boolean;
}

// ── Readiness ──
export interface ReadinessItem {
  code: string;
  scope: string;
  targetId?: string;
}
export interface ReadinessReport {
  revisionId: string;
  reviewReady: boolean;
  publishReady: boolean;
  blockers: ReadinessItem[];
  warnings: ReadinessItem[];
}

// ── Learner preview (answerKey-stripped, projected) ──
export type PreviewActivity = {
  id: string;
  type: ActivityType;
  position: number;
} & Record<string, unknown>;
export interface PreviewResponse {
  revisionId: string;
  lessonId: string;
  version: number;
  status: RevisionStatus;
  title: string;
  description: string | null;
  estimatedDurationMin: number | null;
  activities: PreviewActivity[];
}

// ── Bulk import (Phase 2.2D, TD-253) ──
export interface ImportIssue {
  code: string;
  path: string;
  contentKey?: string;
}
export interface ImportSummary {
  skillsToCreate: number;
  skillsReused: number;
  lessonsToCreate: number;
  revisionsToCreate: number;
  activitiesToCreate: number;
  lessonSkillMappings: number;
  activitySkillMappings: number;
  prerequisitesToCreate: number;
}
export interface ImportValidateResponse {
  schemaVersion: string;
  documentHash: string;
  valid: boolean;
  summary: ImportSummary;
  errors: ImportIssue[];
  warnings: ImportIssue[];
}
export interface ImportApplyResponse {
  schemaVersion: string;
  documentHash: string;
  summary: ImportSummary;
  lessons: { contentKey: string; lessonId: string; revisionId: string }[];
}

// ── Learner product (Phase 3.0) ──
export interface LearnerProfile {
  id: string;
  displayName: string | null;
  dateOfBirth: string | null; // YYYY-MM-DD
  timezone: string | null;
  preferredLanguage: string | null;
  onboarding: { completed: boolean; completedAt: string | null };
}

export interface OnboardingStatus {
  completed: boolean;
  canComplete: boolean;
  missing: string[]; // e.g. 'displayName' | 'dateOfBirth' | 'timezone' | 'learningIntent'
}

export interface OnboardingSubject {
  id: string;
  slug: string;
  title: string;
  description: string | null;
}
export type OnboardingTrack = OnboardingSubject;

export interface LearningIntent {
  id: string;
  subject: { id: string; slug: string; title: string };
  track: { id: string; slug: string; title: string } | null;
}

export interface RoadmapItem {
  id: string;
  position: number;
  state: 'COMPLETED' | 'UNAVAILABLE' | 'IN_PROGRESS' | 'BLOCKED' | 'AVAILABLE';
  skillId: string | null;
  lesson: { id: string | null; title: string | null };
}
export interface RoadmapProgress {
  id: string;
  subjectId: string;
  trackId: string;
  status: string;
  sourceAssessmentAttemptId: string | null;
  progress: { total: number; completed: number; inProgress: number; available: number; blocked: number; unavailable: number; progressBp: number };
  nextItemId: string | null;
  items: RoadmapItem[];
}

export interface DailyPlanItem {
  id: string;
  kind: string;
  itemType: string;
  position: number;
  state: string | null;
  lesson: { id: string | null; title: string | null };
  skill?: { id: string; name: string | null };
}
export interface DailyPlan {
  id: string;
  localDate: string;
  timezone: string;
  generationNo: number;
  status: string;
  topic: { id: string; title: string } | null;
  done: boolean;
  progress: { total: number; completed: number; progressBp: number };
  items: DailyPlanItem[];
}

// ── Placement / diagnostic assessment (Phase 02B) — mirrors the real learner-facing backend shapes ──
export type PlacementItemFormat = 'single_choice' | 'multiple_choice' | 'true_false';
/** Learner projection: NEVER carries answerKey / difficulty / skillId / correctness. */
export interface LearnerFacingItem {
  id: string;
  type: string;
  format: PlacementItemFormat;
  prompt: string;
  options?: { id: string; text: string }[];
}
export interface AttemptView {
  attemptId: string;
  status: string; // 'IN_PROGRESS' | 'COMPLETED'
  engineVersion: string;
  progress: { answered: number; maxItems: number }; // maxItems is a CEILING, not a promised count
  item: LearnerFacingItem | null; // null when COMPLETED
  result: { answered: number; objectiveCorrect: number; coverageComplete: boolean; insufficientSkillIds: string[] } | null;
}
/** Answer body — the real camelCase contract; single/true_false vs multiple_choice. No clientRequestId. */
export type PlacementAnswer = { selectedOptionId: string } | { selectedOptionIds: string[] };

export interface DiagnosticSkill {
  skillId: string;
  name: string;
  masteryScoreBp: number; // basis points 0..10000
  confidenceBp: number | null;
  displayLevel: string | null; // null in v1 — never fabricate a level when null
  measuredAt: string;
}
export interface DiagnosticSnapshot {
  attemptId?: string;
  derivationVersion: string;
  skills: DiagnosticSkill[];
}

// ── Learning + Review (Phase 04) — learner-facing projections; NEVER carry answerKey/correctness in the payload ──

/** Learner-safe media attached to an activity — id/kind/mime/altText only (fetch bytes via GET /api/media/:id/content). */
export interface LearnerMedia {
  id: string;
  kind: string; // 'image' | 'audio'
  mimeType: string;
  altText: string | null;
}

/** Structured production formats (lesson-activity-structured/v1) — beyond multiple-choice. */
export type StructuredFormat = 'sentence_order' | 'fill_blank' | 'controlled_text';
export type FillBlankSegment = { text: string } | { blankId: string };

/** A projected learner Activity. Discriminate by field: choice/structured have `format`, prose has `markdown`, media/deferred has neither. */
export type LearnerActivity =
  | { id: string; type: string; position: number; media?: LearnerMedia[]; format: PlacementItemFormat; prompt: string; options: { id: string; text: string }[] }
  | { id: string; type: string; position: number; media?: LearnerMedia[]; schemaVersion: string; format: 'sentence_order'; prompt: string; tokens: { id: string; text: string }[] }
  | { id: string; type: string; position: number; media?: LearnerMedia[]; schemaVersion: string; format: 'fill_blank'; prompt: string; segments: FillBlankSegment[]; blankIds: string[] }
  | { id: string; type: string; position: number; media?: LearnerMedia[]; schemaVersion: string; format: 'controlled_text'; prompt: string }
  | { id: string; type: string; position: number; media?: LearnerMedia[]; schemaVersion: string; format: 'listening_comprehension'; prompt: string; options: { id: string; text: string }[] }
  | { id: string; type: string; position: number; media?: LearnerMedia[]; schemaVersion: string; markdown: string }
  | { id: string; type: string; position: number; media?: LearnerMedia[] };

const CHOICE_FORMATS: readonly string[] = ['single_choice', 'multiple_choice', 'true_false'];
const STRUCTURED_FORMATS: readonly string[] = ['sentence_order', 'fill_blank', 'controlled_text'];

export function isObjectiveActivity(a: LearnerActivity): a is Extract<LearnerActivity, { format: PlacementItemFormat }> {
  return 'format' in a && CHOICE_FORMATS.includes(a.format);
}
export function isStructuredActivity(a: LearnerActivity): a is Extract<LearnerActivity, { format: StructuredFormat }> {
  return 'format' in a && STRUCTURED_FORMATS.includes(a.format);
}
/** A listening comprehension activity: a canonical audio stimulus (in `media`) + a single-choice comprehension question. */
export function isListeningActivity(a: LearnerActivity): a is Extract<LearnerActivity, { format: 'listening_comprehension' }> {
  return 'format' in a && a.format === 'listening_comprehension';
}
/** The audio stimulus attached to a listening activity, if any (id → GET /api/media/:id/content). */
export function audioMediaOf(a: LearnerActivity): LearnerMedia | undefined {
  return a.media?.find((m) => m.kind === 'audio');
}
export function isMarkdownActivity(a: LearnerActivity): a is Extract<LearnerActivity, { markdown: string }> {
  return 'markdown' in a;
}

/** Answer body for a choice objective activity — same camelCase shape as placement. */
export type ActivityAnswer = PlacementAnswer;
/** Answer bodies for structured production activities — the exact server-validated camelCase shapes. */
export type StructuredAnswer = { orderedTokenIds: string[] } | { blanks: Record<string, string> } | { text: string };
/** Learner-safe structured feedback returned by the server on a structured attempt (never the answer key). */
export interface StructuredFeedback {
  hint: string; // 'sentence_order' | 'fill_blank' | 'controlled_text'
  remediation?: string;
  incorrectBlankIds?: string[];
}

export interface LessonExecutionView {
  lessonId: string;
  lessonRevisionId: string; // the PINNED revision — render exactly this
  progress: { status: string; startedAt: string; lastActivityId: string | null };
  lesson: { title: string; description: string | null; estimatedDurationMin: number | null };
  activities: LearnerActivity[]; // ALL activities, ordered by position; no per-activity answered set is returned
}

/** Objective attempt result — server is the scoring authority. Carries correctness only; never an explanation or answerKey. */
export interface ActivityAttemptView {
  attemptId: string;
  activityId: string;
  attemptNo: number;
  isCorrect: boolean;
  deterministicScore: number; // 10000 correct / 0 incorrect
  status: string;
  submittedAt: string | null;
  reviewSessionId?: string;
}

export interface LessonCompletionView {
  lessonId: string;
  lessonRevisionId: string;
  status: string; // COMPLETED
  completedAt: string;
  mastery: { measured: boolean; skills?: { skillId: string; scoreBp: number; confidenceBp: number; evidenceCount: number; displayLevel: string | null }[] };
}

export interface ReviewCandidate {
  lesson: { id: string; title: string; topicId: string };
  exposure: string; // IN_PROGRESS | COMPLETED
  directTrigger: boolean;
}
export interface ReviewGroup {
  skill: { id: string; name: string };
  signalTypes: string[]; // enum strings (WEAK_SKILL / REVIEW_DUE / REPEATED_MISTAKE)
  candidates: ReviewCandidate[];
}
export interface ReviewCandidateResult {
  subjectId: string;
  groups: ReviewGroup[];
  uncoveredSkillIds: string[];
}

/** A review activity is a projected learner activity (choice / structured / listening) plus this session's attempt state. */
export type ReviewSessionActivity = LearnerActivity & {
  attempted: boolean;
  attemptCount: number;
  bestDeterministicScore: number;
};
export interface ReviewSessionView {
  id: string;
  status: string; // ACTIVE | COMPLETED
  skill: { id: string; name: string };
  lesson: { id: string };
  lessonRevisionId: string;
  startedAt: string;
  completedAt: string | null;
  mastery: { measured: boolean } & Record<string, unknown>; // learner-safe summary; not rendered in Phase 04
  activities: ReviewSessionActivity[];
}

// ── Progress / skill state (Phase 05) — subject-scoped, backend-derived. GET /api/skill-profile/me/subjects/:subjectId ──
export interface SkillState {
  skillId: string;
  name: string;
  masteryScoreBp: number; // basis points 0..10000 — how well the skill is currently demonstrated
  confidenceBp: number | null; // basis points 0..10000, or null when evidence is insufficient — NOT the same as mastery
  evidenceCount: number; // number of measurements supporting the estimate
  displayLevel: string | null; // ALWAYS null in v1 — never fabricate a CEFR/level when null
  lastMeasurementAt: string | null;
}
export interface SkillProfileView {
  subject: { id: string; title: string };
  skills: SkillState[];
}

// ── XP (Phase 05) — a LEARNING-PROGRESS score with a REAL backend level curve (xp-progression-v1). GET /api/xp/me.
// DISTINCT from IZL (the platform currency): never combined into one balance/bar. No ranks/titles/badges, no history. ──
export interface XpProgression {
  totalXp: number; // authoritative signed total = SUM of grants (non-negative in practice)
  progressionXp: number; // max(totalXp, 0) — value the level curve consumes
  currentLevel: number; // >= 1 (a real backend concept)
  currentLevelStartXp: number;
  nextLevelXp: number;
  xpIntoLevel: number;
  xpToNextLevel: number;
  progressBp: number; // 0..9999 — progress WITHIN the current level
  progressionVersion: string;
}

// ── IZL (Phase 05) — the platform REWARD CURRENCY wallet. GET /api/izl/me. Integer IZL units; 0-state is {0,0,0}.
// DISTINCT from XP. Read-only in Phase 05 (no buy/withdraw/transfer/redeem UI). Reserved funds are NOT spendable. ──
export interface IzlBalance {
  balanceIzl: number; // signed net ledger sum (total earned, minus any redemptions)
  reservedIzl: number; // >= 0 — held, never spendable
  availableIzl: number; // balanceIzl - reservedIzl
}

// ── Daily missions (Phase 05) — today's fixed catalog status. GET /api/daily-missions/me/today.
// Read-only: the read model carries NO reward/XP/IZL fields and there is NO claim command (rewards auto-granted). ──
export type DailyMissionCode = 'LEARN_TODAY' | 'MASTERY_TEST_90';
export interface DailyMissionStatus {
  code: string; // a DailyMissionCode in practice; the backend catalog is authoritative
  completed: boolean;
  completedAt: string | null;
  policyVersion: string;
}
export interface DailyMissionsView {
  localDate: string;
  timezone: string;
  missions: DailyMissionStatus[];
}
