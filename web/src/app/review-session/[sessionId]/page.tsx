'use client';

import { useCallback, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { FiCheckCircle } from 'react-icons/fi';
import { useT } from '@/lib/i18n/i18n-context';
import { useResource } from '@/lib/hooks/use-resource';
import { completeReviewSession, getReviewSession, submitReviewActivity } from '@/lib/api/review';
import { isAbortError, isApiError } from '@/lib/api/errors';
import { describeError } from '@/lib/ui/error-text';
import { isObjectiveActivity, isStructuredActivity, isListeningActivity, type ActivityAnswer, type StructuredAnswer, type ReviewSessionView } from '@/lib/api/types';
import { Button, ButtonLink, Spinner } from '@/components/ui';
import { ErrorState } from '@/components/ui/states';
import { FocusLearningShell } from '@/components/learning/FocusLearningShell';
import { QuestionCard } from '@/components/learning/QuestionCard';
import { StructuredActivityCard } from '@/components/learning/StructuredActivityCard';
import { ListeningActivityCard } from '@/components/learning/ListeningActivityCard';
import { FeedbackBanner } from '@/components/learning/FeedbackBanner';

export default function ReviewSessionPage() {
  const t = useT();
  const router = useRouter();
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const res = useResource(useCallback(() => getReviewSession(sessionId), [sessionId]), [sessionId]);
  const exit = () => router.push('/learn/today'); // Today is the hub — review completion/exit returns there (refreshed)

  if (res.data) return <Runner initial={res.data} onExit={exit} />;
  return (
    <FocusLearningShell context={t('learner.review.context')} onExit={exit} exitLabel={t('learner.review.exit')}>
      {res.loading ? (
        <div className="grid min-h-[40vh] place-items-center" role="status" aria-live="polite"><Spinner label={t('learner.common.loading')} /></div>
      ) : isApiError(res.error) && res.error.code === 'REVIEW_SESSION_NOT_FOUND' ? (
        <div className="rounded-panel border border-border bg-surface p-6 text-center">
          <p className="font-medium text-text">{t('learner.review.notFoundTitle')}</p>
          <div className="mt-4 flex justify-center"><ButtonLink href="/learn/today">{t('learner.review.backToToday')}</ButtonLink></div>
        </div>
      ) : (
        <ErrorState error={res.error} onRetry={res.reload} />
      )}
    </FocusLearningShell>
  );
}

function Runner({ initial, onExit }: { initial: ReviewSessionView; onExit: () => void }) {
  const t = useT();
  const activities = initial.activities;
  // Resume at the first un-attempted activity (server owns `attempted`); all attempted → the finish step.
  const firstUnanswered = activities.findIndex((a) => !a.attempted);
  const [index, setIndex] = useState(firstUnanswered < 0 ? activities.length : firstUnanswered);
  const [feedback, setFeedback] = useState<{ isCorrect: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [completed, setCompleted] = useState(initial.status === 'COMPLETED');

  const current = activities[index];
  const progress = { value: Math.min(index, activities.length), max: Math.max(activities.length, 1) };

  function advance() {
    setFeedback(null);
    setActionError(null);
    setIndex((i) => Math.min(i + 1, activities.length));
  }

  async function onSubmit(activityId: string, answer: ActivityAnswer | StructuredAnswer) {
    setActionError(null);
    setBusy(true);
    try {
      const r = await submitReviewActivity(initial.id, activityId, answer);
      setFeedback({ isCorrect: r.isCorrect });
    } catch (e) {
      if (!isAbortError(e)) setActionError(e);
    } finally {
      setBusy(false);
    }
  }

  async function onFinish() {
    setActionError(null);
    setBusy(true);
    try {
      await completeReviewSession(initial.id);
      setCompleted(true);
    } catch (e) {
      if (!isAbortError(e)) setActionError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <FocusLearningShell context={t('learner.review.context')} progress={completed ? { value: 1, max: 1 } : progress} progressLabel={t('learner.review.progressLabel')} onExit={onExit} exitLabel={t('learner.review.exit')}>
      {actionError != null && (
        <p role="alert" className="mb-4 rounded-control bg-danger-tint px-3.5 py-2.5 text-sm font-medium text-danger">{describeError(actionError, t)}</p>
      )}

      {completed ? (
        <div className="rounded-panel border border-border bg-surface p-6 text-center">
          <FiCheckCircle className="mx-auto text-3xl text-success" aria-hidden />
          <h1 className="mt-3 text-xl font-bold text-text">{t('learner.review.completedTitle')}</h1>
          <p className="mt-1 text-muted">{t('learner.review.completedBody')}</p>
          <div className="mt-5 flex justify-center"><ButtonLink href="/learn/today">{t('learner.review.backToToday')}</ButtonLink></div>
        </div>
      ) : !current ? (
        <div className="rounded-panel border border-border bg-surface p-6 text-center">
          <p className="font-medium text-text">{t('learner.review.readyToFinish')}</p>
          <div className="mt-4 flex justify-center">
            <Button size="xl" onClick={onFinish} loading={busy} disabled={busy} className="min-w-[220px]">{t('learner.review.finish')}</Button>
          </div>
        </div>
      ) : feedback ? (
        <div className="flex flex-col gap-6">
          <p className="text-lg font-semibold text-text">{'prompt' in current ? current.prompt : ''}</p>
          <FeedbackBanner isCorrect={feedback.isCorrect} />
          <div className="flex justify-end"><Button size="xl" onClick={advance} className="min-w-[200px]">{t('learner.review.next')}</Button></div>
        </div>
      ) : isStructuredActivity(current) ? (
        <StructuredActivityCard
          key={current.id}
          activity={current}
          onSubmit={(answer) => onSubmit(current.id, answer)}
          submitting={busy}
          submitLabel={t('learner.review.check')}
        />
      ) : isListeningActivity(current) ? (
        <ListeningActivityCard
          key={current.id}
          activity={current}
          onSubmit={(answer) => onSubmit(current.id, answer)}
          submitting={busy}
          submitLabel={t('learner.review.check')}
        />
      ) : isObjectiveActivity(current) ? (
        <QuestionCard
          item={{ id: current.id, type: current.type, format: current.format, prompt: current.prompt, options: current.options }}
          onSubmit={(answer) => onSubmit(current.id, answer)}
          submitting={busy}
          submitLabel={t('learner.review.check')}
        />
      ) : null}
    </FocusLearningShell>
  );
}
