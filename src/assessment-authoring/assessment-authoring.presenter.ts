import { AssessmentPurposeScope, ContainerStatus, RevisionStatus } from '@prisma/client';
import { parseItemPayload, projectItemForLearner, type LearnerFacingItem } from '../assessment/scoring/item-payload';
import { type PlacementConfig } from '../assessment/engine/placement-engine.types';

/** Staff-visible definition view (stable identity + pointer). */
export interface DefinitionView {
  id: string;
  subjectId: string;
  purposeScope: AssessmentPurposeScope;
  title: string;
  description: string | null;
  status: ContainerStatus;
  currentVersionId: string | null;
  updatedAt: string;
}

/** Version summary for the list. */
export interface VersionSummary {
  id: string;
  versionNo: number;
  status: RevisionStatus;
  isCurrent: boolean;
  publishedAt: string | null;
  updatedAt: string;
  itemCount: number;
}

/** Structured staff config DTO — editable fields plus read-only system fields (never a raw JSON blob). */
export interface StaffConfigView {
  itemsPerSkill: number;
  maxItems: number;
  startDifficulty: number;
  system: { stepUp: number; stepDown: number; minDifficulty: number; maxDifficulty: number };
}

/** Staff item view — INCLUDES answerKey (authorized staff only; never a learner shape). */
export interface StaffItemView {
  id: string;
  format: string;
  prompt: string;
  options: { id: string; text: string }[];
  answerKey: { correctOptionIds: string[] };
  skillId: string;
  difficulty: number;
  ordering: number;
  updatedAt: string;
}

export function toDefinitionView(d: {
  id: string;
  subjectId: string;
  purposeScope: AssessmentPurposeScope;
  title: string;
  description: string | null;
  status: ContainerStatus;
  currentVersionId: string | null;
  updatedAt: Date;
}): DefinitionView {
  return {
    id: d.id,
    subjectId: d.subjectId,
    purposeScope: d.purposeScope,
    title: d.title,
    description: d.description ?? null,
    status: d.status,
    currentVersionId: d.currentVersionId ?? null,
    updatedAt: d.updatedAt.toISOString(),
  };
}

export function toVersionSummary(
  v: { id: string; versionNo: number; status: RevisionStatus; publishedAt: Date | null; updatedAt: Date },
  currentVersionId: string | null,
  itemCount: number,
): VersionSummary {
  return {
    id: v.id,
    versionNo: v.versionNo,
    status: v.status,
    isCurrent: currentVersionId === v.id,
    publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
    updatedAt: v.updatedAt.toISOString(),
    itemCount,
  };
}

export function toStaffConfig(c: PlacementConfig): StaffConfigView {
  return {
    itemsPerSkill: c.coverage.itemsPerSkill,
    maxItems: c.stopping.maxItems,
    startDifficulty: c.selection.startDifficulty,
    system: {
      stepUp: c.selection.stepUp,
      stepDown: c.selection.stepDown,
      minDifficulty: c.profileScale.minDifficulty,
      maxDifficulty: c.profileScale.maxDifficulty,
    },
  };
}

/** Staff item view (answerKey included). `payload` is the stored JSONB; parsed by the shared authority. `ordering` is the 0-based display position, `difficulty` is the effective difficulty. */
export function toStaffItem(row: {
  id: string;
  payload: unknown;
  skillId: string;
  difficulty: number;
  difficultyOverride: number | null;
  updatedAt: Date;
  ordering: number;
}): StaffItemView {
  const p = parseItemPayload(row.payload);
  return {
    id: row.id,
    format: p.format,
    prompt: p.prompt,
    options: p.options ? p.options.map((o) => ({ id: o.id, text: o.text })) : [],
    answerKey: { correctOptionIds: p.answerKey?.correctOptionIds ?? [] },
    skillId: row.skillId,
    difficulty: row.difficultyOverride ?? row.difficulty,
    ordering: row.ordering,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Learner-safe preview item — the EXACT shared learner projection (answerKey/skillId/difficulty stripped). */
export function toLearnerPreviewItem(row: { id: string; type: string; payload: unknown }): LearnerFacingItem {
  return projectItemForLearner(row.id, row.type, parseItemPayload(row.payload));
}
