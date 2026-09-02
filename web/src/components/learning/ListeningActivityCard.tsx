'use client';

import { FiHeadphones } from 'react-icons/fi';
import { useT } from '@/lib/i18n/i18n-context';
import { LessonMedia } from '@/components/learning/LessonMedia';
import { QuestionCard } from '@/components/learning/QuestionCard';
import { audioMediaOf, type LearnerActivity, type PlacementAnswer } from '@/lib/api/types';

type ListeningActivity = Extract<LearnerActivity, { format: 'listening_comprehension' }>;

/**
 * Listening comprehension: the learner plays a canonical AUDIO stimulus (fetched through the authenticated media
 * transport by LessonMedia — never a public URL) and then answers a single-choice comprehension question. The audio
 * is attached RELATIONALLY (in `activity.media`); the payload never carries a URL. Scoring is the deterministic
 * single_choice path, so the answer is `{ selectedOptionId }`. No transcript or answer key is ever present client-side.
 */
export function ListeningActivityCard({
  activity,
  onSubmit,
  submitting,
  submitLabel,
  questionLabel,
}: {
  activity: ListeningActivity;
  onSubmit: (answer: PlacementAnswer) => void;
  submitting?: boolean;
  submitLabel: string;
  questionLabel?: string;
}) {
  const t = useT();
  const audio = audioMediaOf(activity);
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4">
        <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
          <FiHeadphones aria-hidden />
          {t('learner.listening.listenFirst')}
        </span>
        {audio ? (
          <LessonMedia media={[audio]} />
        ) : (
          <p role="alert" className="text-sm text-muted">{t('learner.listening.noAudio')}</p>
        )}
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
