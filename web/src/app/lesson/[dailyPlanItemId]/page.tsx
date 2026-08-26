'use client';

import { useCallback, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { FiCheckCircle } from 'react-icons/fi';
import { useT } from '@/lib/i18n/i18n-context';
import { useResource } from '@/lib/hooks/use-resource';
import { completeLesson, completeViewStep, getLessonExecution, startLesson, submitLessonActivity } from '@/lib/api/learning';
import { isAbortError, isApiError } from '@/lib/api/errors';
import { describeError } from '@/lib/ui/error-text';
import { isObjectiveActivity, type ActivityAnswer, type LearnerActivity, type LessonCompletionView, type LessonExecutionView } from '@/lib/api/types';
import { Button, ButtonLink, Spinner } from '@/components/ui';
import { ErrorState } from '@/components/ui/states';
import { FocusLearningShell } from '@/components/learning/FocusLearningShell';
import { QuestionCard } from '@/components/learning/QuestionCard';
import { LessonActivityView } from '@/components/learning/LessonActivityView';
import { FeedbackBanner } from '@/components/learning/FeedbackBanner';

export default function LessonRunnerPage() {
  const t = useT();
  const router = useRouter();
  const params = useParams<{ dailyPlanItemId: string }>();
  const dailyPlanItemId = params.dailyPlanItemId;
  // start-or-resume on entry: idempotent, never creates a duplicate execution (§14).
  const res = useResource(useCallback(() => startLesson(dailyPlanItemId), [dailyPlanItemId]), [dailyPlanItemId]);
  const exit = () => router.push('/learn/learning');

  if (res.data) return <Runner initial={res.data} onExit={exit} />;
  return (
    <FocusLearningShell context={t('learner.lesson.context')} onExit={exit} exitLabel={t('learner.lesson.exit')}>
      {res.loading ? (
        <div className="grid min-h-[40vh] place-items-center" role="status" aria-live="polite"><Spinner label={t('learner.common.loading')} /></div>
      ) : (
        <StartError error={res.error} onRetry={res.reload} />
      )}
    </FocusLearningShell>
  );
}

/** Start failures map to truthful product states — already completed and not-executable are NOT generic errors (§43). */
function StartError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT();
  const code = isApiError(error) ? error.code : null;
  if (code === 'LESSON_ALREADY_COMPLETED') {
    return <CompletedPanel />;
  }
  if (code === 'DAILY_PLAN_ITEM_NOT_FOUND' || code === 'LESSON_NOT_EXECUTABLE') {
    return (
      <div className="rounded-panel border border-border bg-surface p-6 text-center">
        <p className="font-medium text-text">{t('learner.lesson.notAvailableTitle')}</p>
        <p className="mt-1 text-sm text-muted">{t('learner.lesson.notAvailableBody')}</p>
        <div className="mt-4 flex justify-center"><ButtonLink href="/learn/learning">{t('learner.lesson.backToLearning')}</ButtonLink></div>
      </div>
    );
  }
  return <ErrorState error={error} onRetry={onRetry} />;
}

/** Completion state. When the real lesson title is known (finished in-session), it headlines; otherwise a generic
 *  confirmation (e.g. an already-completed lesson reached without loading the execution). No fabricated XP/IZL/streak. */
function CompletedPanel({ title }: { title?: string }) {
  const t = useT();
  return (
    <div className="rounded-panel border border-border bg-surface p-6 text-center">
      <FiCheckCircle className="mx-auto text-3xl text-success" aria-hidden />
      <h1 className="mt-3 text-xl font-bold text-text">{title ?? t('learner.lesson.completedTitle')}</h1>
      <p className="mt-1 text-muted">{title ? `${t('learner.lesson.completedTitle')} — ${t('learner.lesson.completedBody')}` : t('learner.lesson.completedBody')}</p>
      <div className="mt-5 flex justify-center"><ButtonLink href="/learn/learning">{t('learner.lesson.backToLearning')}</ButtonLink></div>
    </div>
  );
}

/** Small localized orientation label for the current step (Tushuntirish / Misol / Mashq …). No badge for intro TEXT. */
function ActivityKindLabel({ type }: { type: string }) {
  const t = useT();
  const key: Record<string, string> = { EXPLANATION: 'explanation', EXAMPLE: 'example', MINI_QUESTION: 'miniQuestion', PRACTICE: 'practice', MASTERY_TEST: 'masteryTest' };
  const k = key[type];
  if (!k) return null;
  return <span className="text-[11px] font-bold uppercase tracking-wide text-primary">{t(`learner.lesson.kind.${k}`)}</span>;
}

function Runner({ initial, onExit }: { initial: LessonExecutionView; onExit: () => void }) {
  const t = useT();
  const [view, setView] = useState<LessonExecutionView>(initial);
  const lessonId = view.lessonId;
  const activities = view.activities;

  // Resume position: the activity AFTER the last-touched one (server owns lastActivityId; we never track completion authoritatively).
  const initialIndex = (() => {
    const last = view.progress.lastActivityId;
    if (!last) return 0;
    const idx = activities.findIndex((a) => a.id === last);
    return idx < 0 ? 0 : Math.min(idx + 1, activities.length);
  })();
  const [index, setIndex] = useState(initialIndex);
  const [feedback, setFeedback] = useState<{ isCorrect: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [completion, setCompletion] = useState<LessonCompletionView | null>(null);

  const current: LearnerActivity | undefined = activities[index];
  const progress = { value: Math.min(index, activities.length), max: Math.max(activities.length, 1) };

  function advance() {
    setFeedback(null);
    setActionError(null);
    setIndex((i) => Math.min(i + 1, activities.length));
  }

  async function onObjectiveSubmit(activityId: string, answer: ActivityAnswer) {
    setActionError(null);
    setBusy(true);
    try {
      const r = await submitLessonActivity(lessonId, activityId, answer);
      setFeedback({ isCorrect: r.isCorrect }); // correctness is backend-authoritative; no explanation/answerKey returned
    } catch (e) {
      if (isAbortError(e)) return;
      if (isApiError(e) && e.status === 409) {
        try { setView(await getLessonExecution(lessonId)); } catch { /* keep current view */ } // resync from canonical state (§22)
      }
      setActionError(e);
    } finally {
      setBusy(false);
    }
  }

  async function onViewNext(activityId: string) {
    setActionError(null);
    setBusy(true);
    try {
      await completeViewStep(lessonId, activityId);
      advance();
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
      setCompletion(await completeLesson(lessonId));
    } catch (e) {
      if (!isAbortError(e)) setActionError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <FocusLearningShell
      title={view.lesson.title}
      progress={progress}
      progressLabel={t('learner.lesson.progressLabel')}
      progressText={`${progress.value} / ${progress.max}`}
      onExit={onExit}
      exitLabel={t('learner.lesson.exit')}
    >
      {actionError != null && (
        <p role="alert" className="mb-4 rounded-control bg-danger-tint px-3.5 py-2.5 text-sm font-medium text-danger">{describeError(actionError, t)}</p>
      )}

      {completion ? (
        <CompletedPanel title={view.lesson.title} />
      ) : !current ? (
        // Every activity walked — offer the real completion (server verifies eligibility).
        <div className="rounded-panel border border-border bg-surface p-6 text-center">
          <p className="font-medium text-text">{t('learner.lesson.readyToFinish')}</p>
          <div className="mt-4 flex justify-center">
            <Button size="xl" onClick={onFinish} loading={busy} disabled={busy} className="min-w-[220px]">{t('learner.lesson.finish')}</Button>
          </div>
        </div>
      ) : isObjectiveActivity(current) ? (
        <div className="flex flex-col gap-6">
          <ActivityKindLabel type={current.type} />
          {feedback ? (
            <>
              <p className="text-2xl font-bold leading-snug tracking-tight text-text">{current.prompt}</p>
              <FeedbackBanner isCorrect={feedback.isCorrect} />
              <div className="flex justify-end">
                <Button size="xl" onClick={advance} className="min-w-[200px]">{t('learner.lesson.next')}</Button>
              </div>
            </>
          ) : (
            <QuestionCard
              item={{ id: current.id, type: current.type, format: current.format, prompt: current.prompt, options: current.options }}
              onSubmit={(answer) => onObjectiveSubmit(current.id, answer)}
              submitting={busy}
              submitLabel={t('learner.lesson.check')}
            />
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <ActivityKindLabel type={current.type} />
          <LessonActivityView activity={current} />
          <div className="flex justify-end">
            <Button size="xl" onClick={() => onViewNext(current.id)} loading={busy} disabled={busy} className="min-w-[200px]">{t('learner.lesson.continue')}</Button>
          </div>
        </div>
      )}
    </FocusLearningShell>
  );
}
