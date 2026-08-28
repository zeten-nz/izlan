import { apiRequest } from './client';

/**
 * V2 Content Studio API — Roadmap Point authoring. Mirrors the assessments client: every mutation returns the
 * whole PointDetail (OCC tokens ride inside on each revision), and each mutation body carries the relevant
 * `expected*UpdatedAt` token. The backend re-authorizes every call (permission + subject assignment); answer keys
 * are never returned.
 */
const B = '/api/staff/content/v2';

export type RevisionStatus = 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED';
export type ContainerStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type SkillRole = 'REQUIRED' | 'SUPPORTING' | 'OPTIONAL';
export type BindingRole = 'TEACH' | 'PRACTICE' | 'EVIDENCE' | 'EXPOSURE';
export type ReviewOutcome = 'APPROVED' | 'CHANGES_REQUESTED' | 'BLOCKED';

export interface PointListItem {
  id: string;
  pointKey: string;
  status: ContainerStatus;
  title: string;
  editableStatus: RevisionStatus | null;
}
export interface LevelSummary {
  id: string;
  code: string;
  title: string;
  status: ContainerStatus;
  track: { title: string };
}
export interface BindableActivity {
  id: string;
  type: string;
  position: number;
  lessonContentKey: string;
  skills: { code: string | null; name: string }[];
}
export interface SubjectSkill {
  id: string;
  name: string;
  code: string | null;
}

export interface PointBinding {
  id: string;
  activityId: string | null;
  activityType: string | null;
  role: BindingRole;
  position: number;
  lessonContentKey: string | null;
}
export interface PointStage {
  id: string;
  stageKey: string | null;
  stageType: string;
  position: number;
  title: string;
  description: string;
  bindings: PointBinding[];
}
export interface PointSkillGate {
  skillId: string;
  skillName: string;
  role: SkillRole;
  requiredEvidenceKinds: string[];
  minIndependence: number | null;
  expectationRevisionId: string;
}
export interface PointDetail {
  point: { id: string; pointKey: string; status: ContainerStatus; levelId: string; levelCode: string; subjectId: string; trackTitle: string; publishedRevisionId: string | null };
  revision: { id: string; versionNo: number; status: RevisionStatus; title: string; canDo: string[]; sortOrderDefault: number; estimatedEffortMin: number | null; updatedAt: string; editable: boolean };
  skills: { skillId: string; skillName: string; skillCode: string | null; role: SkillRole; expectationId: string }[];
  prerequisites: { prerequisitePointId: string; pointKey: string; title: string | null }[];
  blueprint: { id: string; status: ContainerStatus; revision: { id: string; versionNo: number; status: RevisionStatus; updatedAt: string; editable: boolean; stages: PointStage[] } | null } | null;
  mastery: { id: string; status: ContainerStatus; revision: { id: string; versionNo: number; status: RevisionStatus; policyVersion: string; updatedAt: string; editable: boolean; gates: unknown; skillGates: PointSkillGate[] } | null } | null;
  sources: { id: string; sourceReferenceId: string; title: string; kind: string; locator: string | null; claimRole: string }[];
  issues: { id: string; status: string; severityCode: string; summary: string; activityId: string | null; assessmentItemId: string | null; createdAt: string }[];
}
export interface PointReadinessItem { code: string; scope: string; targetId?: string }
export interface PointReadinessReport { pointId: string; reviewReady: boolean; publishReady: boolean; blockers: PointReadinessItem[]; warnings: PointReadinessItem[] }

// ── reads ──
export const listSubjectLevels = (subjectId: string) => apiRequest<LevelSummary[]>(`${B}/subjects/${subjectId}/levels`);
export const listSubjectSkills = (subjectId: string) => apiRequest<SubjectSkill[]>(`${B}/subjects/${subjectId}/skills`);
export const listBindableActivities = (subjectId: string) => apiRequest<BindableActivity[]>(`${B}/subjects/${subjectId}/bindable-activities`);
export const listPoints = (levelId: string) => apiRequest<PointListItem[]>(`${B}/levels/${levelId}/points`);
export const getPoint = (pointId: string) => apiRequest<PointDetail>(`${B}/points/${pointId}`);
export const getPointReadiness = (pointId: string) => apiRequest<PointReadinessReport>(`${B}/points/${pointId}/readiness`);
export const listSources = () => apiRequest<{ id: string; title: string; kind: string; locator: string | null }[]>(`${B}/sources`);

// ── authoring ──
export const createPoint = (levelId: string, body: { pointKey: string; title: string; canDo?: string[]; sortOrderDefault: number; estimatedEffortMin?: number }) =>
  apiRequest<PointDetail>(`${B}/levels/${levelId}/points`, { method: 'POST', body });
export const revisePoint = (pointId: string) => apiRequest<PointDetail>(`${B}/points/${pointId}/revise`, { method: 'POST', body: {} });
export const updatePointRevision = (revisionId: string, body: { expectedUpdatedAt: string; title?: string; canDo?: string[]; sortOrderDefault?: number; estimatedEffortMin?: number }) =>
  apiRequest<PointDetail>(`${B}/point-revisions/${revisionId}`, { method: 'PATCH', body });
export const setPointSkills = (revisionId: string, body: { expectedUpdatedAt: string; skills: { skillId: string; role: SkillRole }[] }) =>
  apiRequest<PointDetail>(`${B}/point-revisions/${revisionId}/skills`, { method: 'PUT', body });
export const setBlueprintStages = (revisionId: string, body: { expectedUpdatedAt: string; stages: { stageKey?: string; stageType: string; title: string; description?: string; bindings: { activityId: string; role: BindingRole }[] }[] }) =>
  apiRequest<PointDetail>(`${B}/blueprint-revisions/${revisionId}/stages`, { method: 'PUT', body });
export const setMastery = (revisionId: string, body: { expectedUpdatedAt: string; gates: { thresholdBp: number; minIndependence: number; requireAllRequiredSkills?: boolean }; skillGates: { skillId: string; role: SkillRole; requiredEvidenceKinds: string[]; minIndependence?: number }[] }) =>
  apiRequest<PointDetail>(`${B}/mastery-revisions/${revisionId}`, { method: 'PUT', body });
export const createSource = (body: { title: string; kind: string; locator?: string }) => apiRequest<{ id: string; title: string; kind: string; locator: string | null }>(`${B}/sources`, { method: 'POST', body });
export const attachSource = (revisionId: string, body: { sourceReferenceId: string; claimRole: string }) => apiRequest<PointDetail>(`${B}/point-revisions/${revisionId}/sources`, { method: 'POST', body });
export const raiseIssue = (body: { severityCode: string; summary: string; roadmapPointRevisionId: string }) => apiRequest<{ id: string; status: string; severityCode: string; summary: string }>(`${B}/issues`, { method: 'POST', body });
export const resolveIssue = (issueId: string, body: { status: 'RESOLVED' | 'DISMISSED' | 'UNDER_REVIEW' }) => apiRequest<{ id: string; status: string }>(`${B}/issues/${issueId}/resolve`, { method: 'POST', body });

// ── workflow ──
export const submitPointReview = (revisionId: string, body: { expectedUpdatedAt: string }) => apiRequest<PointDetail>(`${B}/point-revisions/${revisionId}/submit-review`, { method: 'POST', body });
export const returnPointToDraft = (revisionId: string, body: { expectedUpdatedAt: string; reason: string }) => apiRequest<PointDetail>(`${B}/point-revisions/${revisionId}/return-draft`, { method: 'POST', body });
export const reviewPoint = (revisionId: string, body: { expectedUpdatedAt: string; outcome: ReviewOutcome; notes?: string }) => apiRequest<PointDetail>(`${B}/point-revisions/${revisionId}/review`, { method: 'POST', body });
export const publishPoint = (revisionId: string, body: { expectedUpdatedAt: string }) => apiRequest<PointDetail>(`${B}/point-revisions/${revisionId}/publish`, { method: 'POST', body });
