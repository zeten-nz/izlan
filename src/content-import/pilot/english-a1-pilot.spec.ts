import { ActivityType } from '@prisma/client';
import {
  EXPECTED,
  LESSON_12_CUMULATIVE_SKILLS,
  PILOT_CONTENT_KEYS,
  PILOT_PREREQUISITE_CHAIN,
  loadManifest,
  parsePackages,
  validatePilot,
} from './english-a1-pilot';

const OBJECTIVE = new Set<ActivityType>([ActivityType.MINI_QUESTION, ActivityType.PRACTICE, ActivityType.MASTERY_TEST]);
const MARKDOWN = new Set<ActivityType>([ActivityType.TEXT, ActivityType.EXPLANATION, ActivityType.EXAMPLE]);
const SUPPORTED = new Set<ActivityType>([...OBJECTIVE, ...MARKDOWN]);

describe('English A1 pilot content (Phase 2.2E, PILOT-*)', () => {
  const packages = parsePackages();
  const lessons = packages.flatMap((p) => p.plan.lessons);

  it('validatePilot() reports VALID with the expected counts', () => {
    const { ok, summary, issues } = validatePilot();
    expect(issues).toEqual([]);
    expect(ok).toBe(true);
    expect(summary).toMatchObject({ topics: EXPECTED.topics, lessons: EXPECTED.lessons, activities: EXPECTED.activities, skills: EXPECTED.skills });
    expect(summary.estimatedDurationMin).toBeGreaterThan(0);
  });

  it('PILOT-PROV-01 all four packages declare AI_ASSISTED provenance', () => {
    for (const p of packages) expect({ file: p.file, source: p.plan.provenance.source }).toEqual({ file: p.file, source: 'AI_ASSISTED' });
  });

  it('PILOT-12-CUMULATIVE the Lesson 12 cumulative multiple_choice maps every skill it measures', () => {
    const l12 = lessons.find((l) => l.contentKey === 'ENG-A1-012-PRESENT-SIMPLE-QUESTIONS')!;
    const mc = l12.revision.activities.find((a) => a.type === ActivityType.MASTERY_TEST && (a.payload as { format?: string }).format === 'multiple_choice')!;
    for (const code of LESSON_12_CUMULATIVE_SKILLS) expect(mc.skillCodes).toContain(code);
  });

  it('PILOT-01 manifest describes 4 topics and 12 lessons', () => {
    const m = loadManifest();
    expect(m.topics).toHaveLength(4);
    expect(m.topics.flatMap((t) => t.lessonContentKeys)).toHaveLength(12);
    expect(m.lessonCount).toBe(12);
    expect(m.topicCount).toBe(4);
  });

  it('PILOT-02 all four packages parse through parseImportDocument with zero structural issues', () => {
    expect(packages).toHaveLength(4);
    for (const p of packages) expect({ file: p.file, issues: p.issues }).toEqual({ file: p.file, issues: [] });
  });

  it('PILOT-03 all expected contentKeys are unique and present', () => {
    const keys = lessons.map((l) => l.contentKey);
    expect(keys).toHaveLength(12);
    expect(new Set(keys).size).toBe(12);
    expect([...keys].sort()).toEqual([...PILOT_CONTENT_KEYS].sort());
  });

  it('PILOT-04 Skill code/name declarations are consistent across packages', () => {
    const nameByCode = new Map<string, string>();
    for (const p of packages) {
      for (const s of p.plan.skills) {
        if (nameByCode.has(s.code)) expect(s.name).toBe(nameByCode.get(s.code));
        else nameByCode.set(s.code, s.name);
      }
    }
    expect(nameByCode.size).toBe(EXPECTED.skills);
  });

  it('PILOT-05 prerequisite sequence exactly matches the approved 001→012 chain', () => {
    const byKey = new Map(lessons.map((l) => [l.contentKey, l]));
    for (const { lesson, requires } of PILOT_PREREQUISITE_CHAIN) {
      const l = byKey.get(lesson)!;
      expect(l.prerequisiteContentKeys).toEqual(requires === null ? [] : [requires]);
    }
  });

  it('PILOT-06 every lesson has a skill, an explanation/example, objective practice, and a mastery test', () => {
    for (const l of lessons) {
      const acts = l.revision.activities;
      expect(l.skillCodes.length).toBeGreaterThanOrEqual(1);
      expect(acts.some((a) => a.type === ActivityType.EXPLANATION || a.type === ActivityType.EXAMPLE)).toBe(true);
      expect(acts.some((a) => a.type === ActivityType.PRACTICE || a.type === ActivityType.MASTERY_TEST)).toBe(true);
      expect(acts.some((a) => a.type === ActivityType.MASTERY_TEST)).toBe(true);
    }
  });

  it('PILOT-07 every objective activity has at least one skillCode', () => {
    for (const l of lessons) {
      for (const a of l.revision.activities) {
        if (OBJECTIVE.has(a.type)) expect(a.skillCodes.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('PILOT-08 no unsupported activity types are used', () => {
    for (const l of lessons) for (const a of l.revision.activities) expect(SUPPORTED.has(a.type)).toBe(true);
  });

  it('PILOT-09 no raw HTML in any Markdown body', () => {
    const htmlTag = /<\/?[a-zA-Z][^>]*>/;
    for (const l of lessons) {
      for (const a of l.revision.activities) {
        if (MARKDOWN.has(a.type)) {
          const md = (a.payload as { markdown: string }).markdown;
          expect(htmlTag.test(md)).toBe(false);
        }
      }
    }
  });

  it('PILOT-10 answer-key sentinels never appear inside Markdown content', () => {
    for (const l of lessons) {
      for (const a of l.revision.activities) {
        if (MARKDOWN.has(a.type)) {
          const md = (a.payload as { markdown: string }).markdown;
          expect(md).not.toContain('answerKey');
          expect(md).not.toContain('correctOptionIds');
        }
      }
    }
  });
});
