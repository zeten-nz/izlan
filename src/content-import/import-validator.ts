import { PrereqEdge, wouldCreatePrerequisiteCycle } from '../content-authoring/prerequisite-graph';
import type { ImportIssue, ImportPlan, ImportSummary } from './import-contract';

export interface ExistingLesson {
  id: string;
  contentKey: string;
  status: string;
  subjectId: string;
}
export interface ExistingSkill {
  id: string;
  code: string | null;
  name: string;
  status: string;
}

/** Everything apply needs to create the batch, computed once during resolution. */
export interface ImportResolution {
  existingSkillIdByCode: Map<string, string>; // ACTIVE existing skills reused (code → id)
  existingLessonIdByContentKey: Map<string, string>; // valid existing prerequisite targets (contentKey → id)
}

export interface ResolveInput {
  subjectId: string;
  plan: ImportPlan;
  existingLessons: ExistingLesson[]; // lessons matching plan contentKeys ∪ referenced prerequisite keys
  subjectSkills: ExistingSkill[];
  existingEdges: PrereqEdge[]; // whole-Subject prerequisite graph
}

const NEW = (contentKey: string) => `new:${contentKey}`; // synthetic DAG node id for a not-yet-created lesson

/**
 * DB-dependent import validation (pure — the service fetches the DB snapshot / tx rows and passes them in). Collects
 * issues (never throws) so validate reports them all, and apply can re-run identically. Also returns the summary and
 * the resolution maps apply uses. Skills/prerequisites resolve ONLY inside the destination Subject (no cross-Subject).
 */
export function resolveAndValidate(input: ResolveInput): { issues: ImportIssue[]; summary: ImportSummary; resolution: ImportResolution } {
  const { subjectId, plan } = input;
  const issues: ImportIssue[] = [];

  const existingLessonByKey = new Map(input.existingLessons.map((l) => [l.contentKey, l]));
  const existingSkillByCode = new Map<string, ExistingSkill>();
  const existingSkillByName = new Map<string, ExistingSkill>();
  for (const s of input.subjectSkills) {
    if (s.code) existingSkillByCode.set(s.code, s);
    existingSkillByName.set(s.name.trim(), s);
  }
  const planLessonKeys = new Set(plan.lessons.map((l) => l.contentKey));
  const declaredSkillByCode = new Map(plan.skills.map((s) => [s.code, s]));

  // ── Lesson contentKey collision (§13, create-only) ──
  plan.lessons.forEach((l, i) => {
    if (existingLessonByKey.has(l.contentKey)) issues.push({ code: 'IMPORT_CONTENT_KEY_EXISTS', path: `lessons[${i}]`, contentKey: l.contentKey });
  });

  // ── Skills: declared reuse/create + reference resolution (§10/11/21) ──
  const existingSkillIdByCode = new Map<string, string>();
  const reusedExistingIds = new Set<string>();
  let skillsToCreate = 0;

  plan.skills.forEach((s, i) => {
    const existing = existingSkillByCode.get(s.code);
    if (existing) {
      if (existing.status === 'ARCHIVED') issues.push({ code: 'IMPORT_SKILL_ARCHIVED', path: `skills[${i}]` });
      else if (existing.name.trim() !== s.name.trim()) issues.push({ code: 'IMPORT_SKILL_CONFLICT', path: `skills[${i}]` }); // canonical name differs
      else {
        existingSkillIdByCode.set(s.code, existing.id);
        reusedExistingIds.add(existing.id);
      }
    } else {
      const nameClash = existingSkillByName.get(s.name.trim());
      if (nameClash) issues.push({ code: 'IMPORT_SKILL_CONFLICT', path: `skills[${i}]` }); // name already used by another Skill
      else skillsToCreate++;
    }
  });

  const resolveSkillRef = (code: string, path: string) => {
    if (declaredSkillByCode.has(code)) return; // created or reused by this batch
    const existing = existingSkillByCode.get(code);
    if (!existing) issues.push({ code: 'IMPORT_SKILL_NOT_FOUND', path });
    else if (existing.status !== 'ACTIVE') issues.push({ code: 'IMPORT_SKILL_ARCHIVED', path });
    else {
      existingSkillIdByCode.set(code, existing.id);
      reusedExistingIds.add(existing.id);
    }
  };

  let lessonSkillMappings = 0;
  let activitySkillMappings = 0;
  let activitiesToCreate = 0;
  plan.lessons.forEach((l, li) => {
    l.skillCodes.forEach((c, ci) => resolveSkillRef(c, `lessons[${li}].skillCodes[${ci}]`));
    lessonSkillMappings += new Set(l.skillCodes).size;
    l.revision.activities.forEach((a, ai) => {
      activitiesToCreate++;
      a.skillCodes.forEach((c, ci) => resolveSkillRef(c, `lessons[${li}].revision.activities[${ai}].skillCodes[${ci}]`));
      activitySkillMappings += new Set(a.skillCodes).size;
    });
  });

  // ── Prerequisites + whole-graph DAG (existing edges + all proposed batch edges) (§22-25) ──
  const existingLessonIdByContentKey = new Map<string, string>();
  const accumulated: PrereqEdge[] = [...input.existingEdges];
  let prerequisitesToCreate = 0;

  plan.lessons.forEach((l, li) => {
    const sourceNode = NEW(l.contentKey);
    l.prerequisiteContentKeys.forEach((key, ki) => {
      const path = `lessons[${li}].prerequisiteContentKeys[${ki}]`;
      if (key === l.contentKey) {
        issues.push({ code: 'IMPORT_PREREQUISITE_CYCLE', path });
        return;
      }
      let targetNode: string | null = null;
      if (planLessonKeys.has(key)) {
        targetNode = NEW(key);
      } else {
        const existing = existingLessonByKey.get(key);
        if (!existing) issues.push({ code: 'IMPORT_PREREQUISITE_NOT_FOUND', path });
        else if (existing.subjectId !== subjectId) issues.push({ code: 'IMPORT_PREREQUISITE_SUBJECT_MISMATCH', path });
        else if (existing.status === 'ARCHIVED') issues.push({ code: 'IMPORT_PREREQUISITE_ARCHIVED', path });
        else {
          targetNode = existing.id;
          existingLessonIdByContentKey.set(key, existing.id);
        }
      }
      if (targetNode) {
        prerequisitesToCreate++;
        if (wouldCreatePrerequisiteCycle(accumulated, sourceNode, targetNode)) issues.push({ code: 'IMPORT_PREREQUISITE_CYCLE', path });
        else accumulated.push({ lessonId: sourceNode, prerequisiteLessonId: targetNode });
      }
    });
  });

  const summary: ImportSummary = {
    skillsToCreate,
    skillsReused: reusedExistingIds.size,
    lessonsToCreate: plan.lessons.length,
    revisionsToCreate: plan.lessons.length,
    activitiesToCreate,
    lessonSkillMappings,
    activitySkillMappings,
    prerequisitesToCreate,
  };
  return { issues, summary, resolution: { existingSkillIdByCode, existingLessonIdByContentKey } };
}
