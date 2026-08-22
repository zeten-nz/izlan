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
