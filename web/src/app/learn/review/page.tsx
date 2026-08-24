'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FiRepeat } from 'react-icons/fi';
import { useT } from '@/lib/i18n/i18n-context';
import { useResource } from '@/lib/hooks/use-resource';
import { fetchLearningIntents } from '@/lib/api/onboarding';
import { fetchReviewCandidates, startReviewSession } from '@/lib/api/review';
import { isAbortError } from '@/lib/api/errors';
import { describeError } from '@/lib/ui/error-text';
import type { LearningIntent, ReviewCandidateResult, ReviewGroup } from '@/lib/api/types';
import { Button, ButtonLink, Card, Select } from '@/components/ui';
import { EmptyState, ResourceView } from '@/components/ui/states';

interface ReviewData {
  intents: LearningIntent[];
  selected: LearningIntent | null;
  candidates: ReviewCandidateResult | null;
}

async function loadReview(subjectId: string | null): Promise<ReviewData> {
  const all = await fetchLearningIntents();
  const withTrack = all.filter((i) => i.track);
  const pool = withTrack.length ? withTrack : all;
  const selected = pool.find((i) => i.subject.id === subjectId) ?? pool[0] ?? null;
  const candidates = selected ? await fetchReviewCandidates(selected.subject.id) : null;
  return { intents: pool, selected, candidates };
}

export default function ReviewLandingPage() {
  const t = useT();
  const router = useRouter();
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const res = useResource(useCallback(() => loadReview(subjectId), [subjectId]), [subjectId]);
  const [startingLesson, setStartingLesson] = useState<string | null>(null);
  const [startError, setStartError] = useState<unknown>(null);

  async function start(subj: string, skillId: string, lessonId: string) {
    setStartError(null);
    setStartingLesson(lessonId);
    try {
      const session = await startReviewSession(subj, skillId, lessonId);
      router.push(`/review-session/${session.id}`); // keep loading state — navigating away
    } catch (e) {
      if (isAbortError(e)) return;
      setStartError(e); // e.g. REVIEW_CANDIDATE_NOT_AVAILABLE — the recommendation went stale; show it, offer refresh
      setStartingLesson(null);
    }
  }

  return (
    <ResourceView loading={res.loading} error={res.error} data={res.data} onRetry={res.reload}>
      {(d) => (
        <div className="space-y-6">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{t('learner.review.title')}</h1>
              <p className="mt-0.5 text-muted">{t('learner.review.subtitle')}</p>
            </div>
            {d.intents.length > 1 && d.selected && (
              <label className="flex items-center gap-2 text-sm text-muted">
                <span>{t('learner.roadmap.subjectLabel')}</span>
                <Select aria-label={t('learner.roadmap.subjectLabel')} value={d.selected.subject.id} onChange={(e) => setSubjectId(e.target.value)} className="h-9 w-auto">
                  {d.intents.map((i) => <option key={i.subject.id} value={i.subject.id}>{i.subject.title}</option>)}
                </Select>
              </label>
            )}
          </header>

          {startError != null && (
            <p role="alert" className="rounded-control bg-danger-tint px-3.5 py-2.5 text-sm font-medium text-danger">
              {describeError(startError, t)} <button type="button" onClick={res.reload} className="ml-1 underline">{t('common.reload')}</button>
            </p>
          )}

          {!d.selected || !d.candidates || d.candidates.groups.length === 0 ? (
            <EmptyState title={t('learner.review.emptyTitle')} message={t('learner.review.emptyBody')} action={<ButtonLink href="/learn/learning" variant="secondary">{t('learner.review.goLearn')}</ButtonLink>} />
          ) : (
            <div className="space-y-5">
              {d.candidates.groups.map((group) => (
                <SkillGroup
                  key={group.skill.id}
                  group={group}
                  startingLesson={startingLesson}
                  onStart={(lessonId) => start(d.selected!.subject.id, group.skill.id, lessonId)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </ResourceView>
  );
}

/** One skill's review recommendations. Shows only learner-friendly fields (skill name + lesson titles); never signal codes/UUIDs. */
function SkillGroup({ group, startingLesson, onStart }: { group: ReviewGroup; startingLesson: string | null; onStart: (lessonId: string) => void }) {
  const t = useT();
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <FiRepeat className="text-primary" aria-hidden />
        <h2 className="text-base font-semibold text-text">{group.skill.name}</h2>
      </div>
      <ul className="mt-3 space-y-2.5">
        {group.candidates.map((c) => (
          <li key={c.lesson.id} className="flex items-center justify-between gap-3 rounded-panel border border-border bg-surface px-4 py-3">
            <span className="min-w-0 truncate text-text">{c.lesson.title}</span>
            <Button size="sm" onClick={() => onStart(c.lesson.id)} loading={startingLesson === c.lesson.id} disabled={startingLesson !== null}>
              {t('learner.review.start')}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
