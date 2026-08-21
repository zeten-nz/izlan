/** daily-review-extra-v1 (TD-133/134). Immutable policy: adds at most ONE optional same-Topic review EXTRA to a
 *  newly-generated DailyPlan. Pure/deterministic — no Prisma, Clock, or signal logic. ReviewCandidate is authority. */
export const DAILY_REVIEW_EXTRA_VERSION = 'daily-review-extra-v1';

/** Canonical planning reason strength (TD-134 §14): acute mistake → scheduled review → general weakness. NOT a score. */
const REASON_ORDER: readonly string[] = ['REPEATED_MISTAKE', 'REVIEW_DUE', 'WEAK_SKILL'];

export interface ReviewExtraCandidate {
  skillId: string;
  groupIndex: number; // skill ordering (1.9A groups are already Skill-ordered)
  candidateIndex: number; // within-group order (1.9A deterministic Lesson hierarchy)
  signalTypes: string[]; // active reasons for the Skill group
  lessonId: string;
  lessonTopicId: string;
  exposure: 'COMPLETED' | 'IN_PROGRESS';
  directTrigger: boolean;
}

const strongestReasonIndex = (signalTypes: string[]): number => {
  let best = REASON_ORDER.length; // unknown/none → lowest priority
  for (const t of signalTypes) {
    const i = REASON_ORDER.indexOf(t);
    if (i >= 0 && i < best) best = i;
  }
  return best;
};

/** Deterministic priority key (lower = better, §13): directTrigger → reason → exposure → skill order → hierarchy → id. */
const key = (c: ReviewExtraCandidate): [number, number, number, number, number, string] => [
  c.directTrigger ? 0 : 1, // §15 direct-trigger first
  strongestReasonIndex(c.signalTypes), // §14 REPEATED_MISTAKE > REVIEW_DUE > WEAK_SKILL
  c.exposure === 'COMPLETED' ? 0 : 1, // §16 COMPLETED before IN_PROGRESS
  c.groupIndex, // §13.4 accepted Skill ordering
  c.candidateIndex, // §13.5 existing 1.9A Lesson hierarchy
  c.lessonId, // §13.6 stable final tie-break
];

function cmp(a: ReviewExtraCandidate, b: ReviewExtraCandidate): number {
  const ka = key(a);
  const kb = key(b);
  for (let i = 0; i < 5; i++) if ((ka[i] as number) !== (kb[i] as number)) return (ka[i] as number) - (kb[i] as number);
  return (ka[5] as string).localeCompare(kb[5] as string);
}

/**
 * Select at most one review EXTRA (daily-review-extra-v1). Filters to the core Topic (§11) and excludes Lessons
 * already in today's core (§12), then returns the single highest-priority (skill, lesson) intent or null.
 */
export function selectReviewExtra(coreTopicId: string, coreLessonIds: ReadonlySet<string>, candidates: ReviewExtraCandidate[]): { lessonId: string; skillId: string } | null {
  const eligible = candidates.filter((c) => c.lessonTopicId === coreTopicId && !coreLessonIds.has(c.lessonId));
  if (eligible.length === 0) return null; // §17/18 — 0 EXTRA is valid
  const best = eligible.reduce((a, b) => (cmp(a, b) <= 0 ? a : b));
  return { lessonId: best.lessonId, skillId: best.skillId };
}
