'use client';

import { FiBookOpen } from 'react-icons/fi';
import { useT } from '@/lib/i18n/i18n-context';
import { QuestionCard } from '@/components/learning/QuestionCard';
import { type LearnerActivity, type PlacementAnswer } from '@/lib/api/types';

type ReadingActivity = Extract<LearnerActivity, { format: 'reading_comprehension' }>;

/**
 * Reading comprehension: the learner reads a short VISIBLE text `passage` (the stimulus) and then answers a
 * single-choice comprehension question about it. The passage is part of the projected activity (it is meant to be
 * read); the answer key is never sent to the client. Scoring is the deterministic single_choice path, so the answer
 * is `{ selectedOptionId }`. No audio/media — the stimulus is inline text.
 */
export function ReadingActivityCard({
  activity,
  onSubmit,
  submitting,
  submitLabel,
  questionLabel,
}: {
  activity: ReadingActivity;
  onSubmit: (answer: PlacementAnswer) => void;
  submitting?: boolean;
  submitLabel: string;
  questionLabel?: string;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4" aria-label={t('learner.reading.readFirst')}>
        <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
          <FiBookOpen aria-hidden />
          {t('learner.reading.readFirst')}
        </span>
        <p className="whitespace-pre-line text-[15px] leading-relaxed text-text">{activity.passage}</p>
      </section>
      <QuestionCard
        // The comprehension question is scored as single_choice on the server.
        item={{ id: activity.id, type: activity.type, format: 'single_choice', prompt: activity.prompt, options: activity.options }}
        onSubmit={onSubmit}
        submitting={submitting}
        submitLabel={submitLabel}
        questionLabel={questionLabel}
      />
    </div>
  );
}
