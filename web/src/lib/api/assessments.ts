import { apiRequest } from './client';
import type { LearnerFacingItem } from './types';

/**
 * Staff diagnostic/placement authoring API (Assessment Builder). Distinct from the LEARNER placement family in
 * `assessment.ts` (singular): this covers `/api/staff/content/assessments/**`. Every mutation returns the full
 * AssessmentVersionDetail — the version's OCC token (version.updatedAt) and each item's token (items[].updatedAt)
 * ride inside it — so callers just replace their held detail after a call (no separate token envelopes to thread).
 */
const B = '/api/staff/content/assessments';

export type AssessmentVersionStatus = 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED';
export type AssessmentDefinitionStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type AssessmentItemFormat = 'single_choice' | 'multiple_choice' | 'true_false';

export interface AssessmentDefinitionView {
  id: string;
  subjectId: string;
  purposeScope: string; // 'DIAGNOSTIC' | 'CHECKPOINT' (V1 authors DIAGNOSTIC only)
  title: string;
  description: string | null;
  status: AssessmentDefinitionStatus;
  currentVersionId: string | null;
  updatedAt: string;
}

export interface AssessmentVersionSummary {
  id: string;
  versionNo: number;
  status: AssessmentVersionStatus;
  isCurrent: boolean;
  publishedAt: string | null;
  updatedAt: string;
  itemCount: number;
}

export interface AssessmentSubjectView {
  definition: AssessmentDefinitionView | null;
  versions: AssessmentVersionSummary[];
}

export interface AssessmentDefinitionWithVersions {
  definition: AssessmentDefinitionView;
  versions: AssessmentVersionSummary[];
}

/** Structured config — Methodist-editable fields plus read-only system fields (never a raw JSON blob). */
export interface AssessmentConfigView {
  itemsPerSkill: number;
  maxItems: number;
  startDifficulty: number;
  system: { stepUp: number; stepDown: number; minDifficulty: number; maxDifficulty: number };
}

/** Staff item view — INCLUDES answerKey (authorized staff-only; never used on a learner surface). */
export interface StaffAssessmentItem {
  id: string;
  format: AssessmentItemFormat;
  prompt: string;
  options: { id: string; text: string }[];
  answerKey: { correctOptionIds: string[] };
  skillId: string;
  difficulty: number;
  ordering: number;
  updatedAt: string;
}

export interface AssessmentVersionDetail {
  version: { id: string; versionNo: number; status: AssessmentVersionStatus; isCurrent: boolean; publishedAt: string | null; updatedAt: string };
  config: AssessmentConfigView;
  items: StaffAssessmentItem[];
}

export interface AssessmentReadinessReport {
  publishReady: boolean;
  checks: {
    hasItems: boolean;
    allPayloadsValid: boolean;
    allObjective: boolean;
    optionsWellFormed: boolean;
    allSkillsActiveAndSameSubject: boolean;
    difficultyInScale: boolean;
    configValid: boolean;
    coveredSkillsMeetItemsPerSkill: boolean;
    maxItemsCanCoverIncludedSkills: boolean;
  };
  coverage: {
    activeSubjectSkillIds: string[];
    coveredSkillIds: string[];
    uncoveredSkillIds: string[];
    itemsPerSkill: Record<string, number>;
    requiredItemsPerSkill: number | null;
  };
  blockers: { code: string; itemId?: string; skillId?: string }[];
  warnings: { code: string; skillId?: string }[];
}

export interface AssessmentPreview {
  versionId: string;
  items: LearnerFacingItem[]; // learner-safe projection — never carries answerKey
}

/** Authorable item fields (shared by create + update). */
export interface AssessmentItemInput {
  format: AssessmentItemFormat;
  prompt: string;
  options: { id: string; text: string }[];
  correctOptionIds: string[];
  skillId: string;
  difficulty: number;
}

// ── Reads ──
export const getSubjectAssessments = (subjectId: string) => apiRequest<AssessmentSubjectView>(`${B}/subjects/${subjectId}`);
export const getAssessmentDefinition = (definitionId: string) => apiRequest<AssessmentDefinitionWithVersions>(`${B}/${definitionId}`);
export const getAssessmentVersion = (versionId: string) => apiRequest<AssessmentVersionDetail>(`${B}/versions/${versionId}`);
export const getAssessmentReadiness = (versionId: string) => apiRequest<AssessmentReadinessReport>(`${B}/versions/${versionId}/readiness`);
export const getAssessmentPreview = (versionId: string) => apiRequest<AssessmentPreview>(`${B}/versions/${versionId}/preview`);

// ── Definition ──
export const ensureAssessmentDefinition = (subjectId: string, body: { title?: string; description?: string } = {}) =>
  apiRequest<AssessmentDefinitionView>(`${B}/subjects/${subjectId}`, { method: 'POST', body });
export const updateAssessmentDefinition = (definitionId: string, body: { expectedUpdatedAt: string; title?: string; description?: string }) =>
  apiRequest<AssessmentDefinitionView>(`${B}/${definitionId}`, { method: 'PATCH', body });

// ── Versions ──
export const createAssessmentVersion = (definitionId: string, body: { mode: 'blank' | 'clone_current' }) =>
  apiRequest<AssessmentVersionDetail>(`${B}/${definitionId}/versions`, { method: 'POST', body });
export const updateAssessmentConfig = (versionId: string, body: { expectedVersionUpdatedAt: string; itemsPerSkill?: number; maxItems?: number; startDifficulty?: number }) =>
  apiRequest<AssessmentVersionDetail>(`${B}/versions/${versionId}`, { method: 'PATCH', body });

// ── Items ──
export const createAssessmentItem = (versionId: string, body: AssessmentItemInput & { expectedVersionUpdatedAt: string }) =>
  apiRequest<AssessmentVersionDetail>(`${B}/versions/${versionId}/items`, { method: 'POST', body });
export const updateAssessmentItem = (itemId: string, body: AssessmentItemInput & { expectedItemUpdatedAt: string }) =>
  apiRequest<AssessmentVersionDetail>(`${B}/items/${itemId}`, { method: 'PATCH', body });
export const deleteAssessmentItem = (itemId: string, body: { expectedItemUpdatedAt: string }) =>
  apiRequest<AssessmentVersionDetail>(`${B}/items/${itemId}`, { method: 'DELETE', body });
export const reorderAssessmentItems = (versionId: string, body: { expectedVersionUpdatedAt: string; orderedItemIds: string[] }) =>
  apiRequest<AssessmentVersionDetail>(`${B}/versions/${versionId}/items/reorder`, { method: 'POST', body });

// ── Workflow ──
export const submitAssessmentReview = (versionId: string, body: { expectedVersionUpdatedAt: string }) =>
  apiRequest<AssessmentVersionDetail>(`${B}/versions/${versionId}/submit-review`, { method: 'POST', body });
export const returnAssessmentToDraft = (versionId: string, body: { expectedVersionUpdatedAt: string; reason: string }) =>
  apiRequest<AssessmentVersionDetail>(`${B}/versions/${versionId}/return-draft`, { method: 'POST', body });
export const publishAssessmentVersion = (versionId: string, body: { expectedVersionUpdatedAt: string }) =>
  apiRequest<AssessmentVersionDetail>(`${B}/versions/${versionId}/publish`, { method: 'POST', body });
