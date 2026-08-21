import { CandidateFacts, EncounteredVisibleLesson, ReviewCandidateResult, ReviewGroup, SIGNAL_TYPE_ORDER } from './review-candidate.types';

const key = (skillId: string, lessonId: string) => `${skillId}::${lessonId}`;

/**
 * review-candidate-v1 (TD-122). Pure/deterministic — no Prisma, HTTP, Clock, or AI. Groups encountered +
 * currently-visible Lessons by Skill from ACTIVE signals: general relevance via explicit LessonSkill OR
 * current-revision ActivitySkill (§11/17/18), plus REPEATED_MISTAKE direct-trigger provenance (§14). One
 * candidate per logical Lesson (dedup, §23); direct-trigger first, then curriculum hierarchy (§24). No score.
 */
export function buildReviewCandidates(facts: CandidateFacts): ReviewCandidateResult {
  const skillsSorted = [...facts.skills].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)); // §38

  const groups: ReviewGroup[] = [];
  const uncoveredSkillIds: string[] = [];

  for (const skill of skillsSorted) {
    const sig = facts.signalsBySkill.get(skill.id);
    if (!sig) continue; // skills come from signals; defensive

    const directSet = new Set(sig.directTriggerLessonIds.filter((l) => facts.visibleLessons.has(l))); // §14/16 visibility-filtered
    const candidateIds = new Set<string>(directSet);
    for (const lessonId of facts.visibleLessons.keys()) {
      if (facts.lessonSkill.has(key(skill.id, lessonId)) || facts.activitySkillCurrent.has(key(skill.id, lessonId))) candidateIds.add(lessonId); // §11
    }

    if (candidateIds.size === 0) {
      uncoveredSkillIds.push(skill.id); // ACTIVE signal but no eligible content (§27/69)
      continue;
    }

    const ordered = [...candidateIds]
      .map((l) => facts.visibleLessons.get(l)!)
      .sort((a, b) => cmp(directSet, a, b));

    groups.push({
      skill: { id: skill.id, name: skill.name },
      signalTypes: SIGNAL_TYPE_ORDER.filter((t) => sig.signalTypes.includes(t)), // §20/21 canonical, deduped
      candidates: ordered.map((l) => ({ lesson: { id: l.lessonId, title: l.title, topicId: l.topicId }, exposure: l.exposure, directTrigger: directSet.has(l.lessonId) })),
    });
  }

  return { groups, uncoveredSkillIds };
}

/** Direct-trigger first (§24), then deterministic curriculum hierarchy, then stable id. */
function cmp(directSet: Set<string>, a: EncounteredVisibleLesson, b: EncounteredVisibleLesson): number {
  return (
    Number(directSet.has(b.lessonId)) - Number(directSet.has(a.lessonId)) ||
    a.levelSort - b.levelSort ||
    a.moduleSort - b.moduleSort ||
    a.topicSort - b.topicSort ||
    a.lessonSort - b.lessonSort ||
    a.lessonId.localeCompare(b.lessonId)
  );
}
