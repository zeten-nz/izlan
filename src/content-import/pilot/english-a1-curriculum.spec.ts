import { ActivityType } from '@prisma/client';
import {
  validateCurriculum,
  parseCurriculumPackages,
  CURRICULUM_POINT_PLAN,
  CURRICULUM_CONTENT_KEYS,
  CURRICULUM_SKILL_CODES,
  CURRICULUM_EVIDENCE_KINDS,
  PREP_PLACE_MASTERY_EVIDENCE_KINDS,
} from './english-a1-curriculum';

const STRUCTURED_V = 'lesson-activity-structured/v1';

/**
 * A1 curriculum-expansion STRUCTURAL validation (no DB). Proves the authored content + point plan are internally
 * coherent before anything is imported/published: canonical parse, real teaching per lesson, honest skill mapping,
 * a valid + acyclic point prerequisite graph, and no answer-key leakage into learner-visible prose.
 */
describe('English A1 curriculum expansion (structural)', () => {
  const validation = validateCurriculum();

  it('CUR-01 parses + passes every cross-file invariant (zero issues)', () => {
    expect(validation.issues).toEqual([]);
    expect(validation.ok).toBe(true);
  });

  it('CUR-02 has the expected shape: 3 topics, 6 lessons, 6 skills, 6 points', () => {
    expect(validation.summary).toMatchObject({ topics: 3, lessons: 6, skills: 6, points: 6 });
    expect(CURRICULUM_CONTENT_KEYS).toHaveLength(6);
    expect(CURRICULUM_SKILL_CODES).toHaveLength(6);
    expect(validation.summary.objectiveActivities).toBeGreaterThanOrEqual(24); // ≥4 objective/lesson
  });

  it('CUR-03 the point prerequisite graph is a valid DAG that BRANCHES (≥2 points share a prerequisite)', () => {
    const planKeys = new Set(CURRICULUM_POINT_PLAN.map((p) => p.pointKey));
    // No self-loop; every prereq resolves; branching → some prereq is shared by ≥2 points (multi-point availability).
    const prereqFanOut = new Map<string, number>();
    for (const spec of CURRICULUM_POINT_PLAN) {
      expect(spec.prerequisitePointKeys).not.toContain(spec.pointKey);
      for (const pre of spec.prerequisitePointKeys) prereqFanOut.set(pre, (prereqFanOut.get(pre) ?? 0) + 1);
    }
    expect([...prereqFanOut.values()].some((n) => n >= 2)).toBe(true); // a real branch (proves >1 available point)
    // Intra-curriculum edges never form a cycle (topological order exists).
    const remaining = new Map(CURRICULUM_POINT_PLAN.map((p) => [p.pointKey, p.prerequisitePointKeys.filter((k) => planKeys.has(k))] as const));
    let progress = true;
    while (remaining.size > 0 && progress) {
      progress = false;
      for (const [key, prereqs] of [...remaining]) {
        if (prereqs.every((k) => !remaining.has(k))) { remaining.delete(key); progress = true; }
      }
    }
    expect(remaining.size).toBe(0); // acyclic
  });

  it('CUR-04 mastery evidence is HONEST — objective grammar claims recognition + controlled-production only (never free-production)', () => {
    expect([...CURRICULUM_EVIDENCE_KINDS]).toEqual(['recognition', 'controlled-production']);
    expect([...CURRICULUM_EVIDENCE_KINDS]).not.toContain('free-production');
  });

  it('CUR-06 a non-Present-Simple point (PREP-PLACE) is taught via STRUCTURED production and honestly requires controlled-production@2', () => {
    // The gate override: recognition (choice) can no longer satisfy this point — only controlled production can.
    const prep = CURRICULUM_POINT_PLAN.find((p) => p.pointKey === 'ENG-A1-PREP-PLACE')!;
    expect(prep.pointKey).not.toContain('PRESENT-SIMPLE');
    expect([...(prep.masteryEvidenceKinds ?? [])]).toEqual([...PREP_PLACE_MASTERY_EVIDENCE_KINDS]);
    expect([...PREP_PLACE_MASTERY_EVIDENCE_KINDS]).toEqual(['controlled-production']);
    expect(prep.masteryMinIndependence).toBe(2);

    // Its lesson's MASTERY_TEST evidence is genuinely structured production (sentence_order / fill_blank), so the
    // controlled-production@2 gate is satisfiable — no disguised multiple-choice standing in for production.
    const packages = parseCurriculumPackages();
    const lesson = packages.flatMap((p) => p.plan.lessons).find((l) => l.contentKey === prep.lessonContentKey)!;
    const masteryPayloads = lesson.revision.activities.filter((a) => a.type === ActivityType.MASTERY_TEST).map((a) => a.payload as { schemaVersion?: string; format?: string });
    expect(masteryPayloads.length).toBeGreaterThanOrEqual(1);
    expect(masteryPayloads.every((p) => p.schemaVersion === STRUCTURED_V)).toBe(true);
    expect(masteryPayloads.map((p) => p.format).sort()).toEqual(['fill_blank', 'sentence_order']);
  });

  it('CUR-05 every lesson teaches (rule + example + mistake) before it tests — not a quiz bank', () => {
    const packages = parseCurriculumPackages();
    for (const p of packages) {
      for (const lesson of p.plan.lessons) {
        const types = lesson.revision.activities.map((a) => a.type);
        // ≥2 view-only teaching activities (motivation/rule/example/mistake) and ≥1 appears before the first objective.
        const views = types.filter((t) => t === ActivityType.TEXT || t === ActivityType.EXPLANATION || t === ActivityType.EXAMPLE);
        expect(views.length).toBeGreaterThanOrEqual(3);
        const firstObjective = types.findIndex((t) => t === ActivityType.MINI_QUESTION || t === ActivityType.PRACTICE || t === ActivityType.MASTERY_TEST);
        const teachingBefore = types.slice(0, firstObjective).filter((t) => t === ActivityType.EXPLANATION || t === ActivityType.EXAMPLE);
        expect(teachingBefore.length).toBeGreaterThanOrEqual(1); // explains before it quizzes
      }
    }
  });
});
