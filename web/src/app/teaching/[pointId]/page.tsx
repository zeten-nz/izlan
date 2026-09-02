'use client';

import { useCallback, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { FiArrowRight, FiAward, FiCheckCircle, FiInfo } from 'react-icons/fi';
import { useT } from '@/lib/i18n/i18n-context';
import { useResource } from '@/lib/hooks/use-resource';
import { isObjectiveActivity, isMarkdownActivity, type ActivityAnswer } from '@/lib/api/types';
import {
  startTeachingSession,
  submitTeachingActivity,
  runMasteryCheck,
  type TeachingSessionView,
  type TeachingStage,
  type TeachingActivity,
  type TeachingAttemptView,
  type MasteryCheckView,
} from '@/lib/api/v2-learning';
import { describeError } from '@/lib/ui/error-text';
import { Button, Card, Spinner } from '@/components/ui';
import { FocusLearningShell } from '@/components/learning/FocusLearningShell';
import { QuestionCard } from '@/components/learning/QuestionCard';
import { FeedbackBanner } from '@/components/learning/FeedbackBanner';
import { LessonActivityView } from '@/components/learning/LessonActivityView';
import { AssistantPanel } from '@/components/learning/AssistantPanel';

type Step =
  | { kind: 'stage'; stage: TeachingStage }
  | { kind: 'view'; stage: TeachingStage; activity: TeachingActivity }
  | { kind: 'objective'; stage: TeachingStage; activity: TeachingActivity }
  | { kind: 'mastery' };

function buildSteps(session: TeachingSessionView): Step[] {
  const steps: Step[] = [];
  for (const stage of session.stages) {
    steps.push({ kind: 'stage', stage });
    for (const activity of stage.activities) {
      if (isObjectiveActivity(activity)) steps.push({ kind: 'objective', stage, activity });
      else steps.push({ kind: 'view', stage, activity });
    }
  }
  steps.push({ kind: 'mastery' });
  return steps;
}

/**
 * Where to open the session. A fresh session (nothing attempted) starts at the beginning so the learner sees
 * the concept first; a resumed session jumps to the earliest un-attempted objective, or the mastery step when
 * every objective has been attempted.
 */
function initialIndex(steps: Step[]): number {
  const anyAttempted = steps.some((s) => s.kind === 'objective' && s.activity.attempted);
  if (!anyAttempted) return 0;
  const firstUnanswered = steps.findIndex((s) => s.kind === 'objective' && !s.activity.attempted);
  if (firstUnanswered >= 0) return firstUnanswered;
  const mastery = steps.findIndex((s) => s.kind === 'mastery');
  return mastery >= 0 ? mastery : 0;
}

export default function TeachingRunnerPage() {
  const params = useParams<{ pointId: string }>();
  const pointId = params.pointId;
  const res = useResource(useCallback(() => startTeachingSession(pointId), [pointId]), [pointId]);

  if (res.loading) return <div className="grid min-h-screen place-items-center bg-bg"><Spinner /></div>;
  if (res.error || !res.data) return <RunnerError onRetry={res.reload} />;
  return <Runner session={res.data} />;
}

function RunnerError({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div className="grid min-h-screen place-items-center bg-bg p-6">
      <Card className="max-w-md p-6 text-center">
        <p className="text-muted">{t('learner.teaching.loadError')}</p>
        <div className="mt-4"><Button onClick={onRetry}>{t('common.retry')}</Button></div>
      </Card>
    </div>
  );
}

function Runner({ session }: { session: TeachingSessionView }) {
  const t = useT();
  const router = useRouter();
  const steps = useMemo(() => buildSteps(session), [session]);
  const [index, setIndex] = useState(() => (session.mastery.learned ? steps.length - 1 : initialIndex(steps)));
  const [feedback, setFeedback] = useState<TeachingAttemptView | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [mastery, setMastery] = useState<MasteryCheckView | null>(session.mastery.learned ? { outcome: 'SATISFIED', satisfied: true, learned: true, acquisitionId: null, gates: [] } : null);

  const step = steps[index];
  const total = steps.length;
  const exit = () => router.push('/learn/today'); // Today is the hub — completion/exit returns there (refreshed), never a dead end
  if (!step) return null;
  // Advisory assistant is offered where a learner may be stuck (a question or the mastery gate). WHY_WRONG is gated on
  // a real incorrect result — the just-submitted answer, or any earlier incorrect attempt in the session.
  const hasRecentMistake = (feedback != null && !feedback.isCorrect) || session.stages.some((s) => s.activities.some((a) => a.lastResult != null && !a.lastResult.isCorrect));
  const showAssistant = step.kind === 'objective' || step.kind === 'mastery';
  const contextLabel = step.kind === 'mastery' ? t('learner.teaching.masteryStage') : step.stage.title;

  function next() {
    setFeedback(null);
    setIndex((i) => Math.min(i + 1, total - 1));
  }

  async function onObjectiveSubmit(activity: TeachingActivity, answer: ActivityAnswer) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const view = await submitTeachingActivity(session.id, activity.id, answer);
      setFeedback(view);
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
    }
  }

  async function onMasteryCheck() {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const view = await runMasteryCheck(session.id);
      setMastery(view);
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
    }
  }

  // Terminal LEARNED state — a real completion panel (not a fake lesson completion).
  if (mastery?.learned) {
    return (
      <FocusLearningShell title={session.title} context={t('learner.teaching.context')} onExit={exit} exitLabel={t('common.close')}>
        <Card className="flex flex-col items-center gap-4 p-8 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-success/10 text-success"><FiAward className="text-3xl" aria-hidden /></span>
          <h1 className="text-2xl font-bold">{t('learner.teaching.learnedTitle')}</h1>
          <p className="text-muted">{t('learner.teaching.learnedBody', { title: session.title })}</p>
          <Button onClick={exit} size="lg">{t('learner.teaching.backToToday')}</Button>
        </Card>
      </FocusLearningShell>
    );
  }

  return (
    <FocusLearningShell
      title={session.title}
      context={contextLabel}
      progress={{ value: index + 1, max: total }}
      progressText={`${index + 1} / ${total}`}
      onExit={exit}
      exitLabel={t('common.close')}
    >
      {actionError != null && (
        <div role="alert" className="mb-4 rounded-panel border border-danger/40 bg-danger/5 p-3 text-sm text-danger">{describeError(actionError, t)}</div>
      )}

      {step.kind === 'stage' && (
        <Card className="flex flex-col gap-3 p-6">
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary"><FiInfo aria-hidden />{stageKindLabel(step.stage.stageType, t)}</span>
          <h1 className="text-2xl font-bold">{step.stage.title}</h1>
          {step.stage.description && <p className="text-muted">{step.stage.description}</p>}
          <div className="mt-2 flex justify-end"><Button onClick={next} size="lg">{t('common.continue')} <FiArrowRight aria-hidden /></Button></div>
        </Card>
      )}

      {step.kind === 'view' && isMarkdownActivity(step.activity) && (
        <div className="flex flex-col gap-6">
          <LessonActivityView activity={step.activity} />
          <div className="flex justify-end"><Button onClick={next} size="lg">{t('common.continue')} <FiArrowRight aria-hidden /></Button></div>
        </div>
      )}

      {step.kind === 'objective' && (
        <div className="flex flex-col gap-6">
          <QuestionCard
            key={step.activity.id}
            item={objectiveItem(step.activity)}
            onSubmit={(a) => onObjectiveSubmit(step.activity, a)}
            submitting={busy}
            submitLabel={t('learner.teaching.check')}
            questionLabel={step.stage.title}
          />
          {feedback && feedback.activityId === step.activity.id && (
            <div className="flex flex-col gap-4">
              <FeedbackBanner isCorrect={feedback.isCorrect} />
              {!feedback.isCorrect && feedback.remediation && (
                <div className="rounded-panel border border-border bg-surface-2 p-4 text-sm text-text">
                  <span className="mb-1 block font-semibold text-muted">{t('learner.teaching.hint')}</span>
                  {feedback.remediation}
                </div>
              )}
              <div className="flex justify-end"><Button onClick={next} size="lg">{t('common.continue')} <FiArrowRight aria-hidden /></Button></div>
            </div>
          )}
        </div>
      )}

      {step.kind === 'mastery' && (
        <Card className="flex flex-col gap-4 p-6">
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary"><FiCheckCircle aria-hidden />{t('learner.teaching.masteryStage')}</span>
          <h1 className="text-2xl font-bold">{t('learner.teaching.masteryTitle')}</h1>
          <p className="text-muted">{t('learner.teaching.masteryBody')}</p>
          {mastery && !mastery.satisfied && (
            <div role="status" className="rounded-panel border border-warning/40 bg-warning/5 p-3 text-sm text-warning">
              {mastery.outcome === 'INSUFFICIENT_EVIDENCE' ? t('learner.teaching.masteryInsufficient') : t('learner.teaching.masteryNotYet')}
            </div>
          )}
          <div className="flex justify-end"><Button onClick={onMasteryCheck} loading={busy} disabled={busy} size="lg">{t('learner.teaching.runMastery')}</Button></div>
        </Card>
      )}

      {showAssistant && (
        <div className="mt-6">
          <AssistantPanel sessionId={session.id} hasRecentMistake={hasRecentMistake} />
        </div>
      )}
    </FocusLearningShell>
  );
}

/** Adapt a projected objective activity to the shared QuestionCard's LearnerFacingItem shape. */
function objectiveItem(a: TeachingActivity) {
  const obj = a as Extract<TeachingActivity, { format: string }>;
  return { id: obj.id, type: obj.type, format: obj.format, prompt: obj.prompt, options: obj.options };
}

function stageKindLabel(stageType: string, t: (k: string) => string): string {
  const key = `learner.teaching.stage.${stageType}`;
  const label = t(key);
  return label === key ? stageType : label;
}
