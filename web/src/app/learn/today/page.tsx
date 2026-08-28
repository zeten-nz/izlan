'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FiArrowRight, FiAlertTriangle, FiCheckCircle, FiClock, FiRefreshCw, FiTarget } from 'react-icons/fi';
import { useT, type TFunc } from '@/lib/i18n/i18n-context';
import { useResource } from '@/lib/hooks/use-resource';
import { isAbortError } from '@/lib/api/errors';
import { describeError } from '@/lib/ui/error-text';
import { fetchMyToday, generateMyToday, type DailyView, type DailyAction, type DailyAttention, type DailyAttentionReason } from '@/lib/api/daily-learning';
import { startPointReview } from '@/lib/api/v2-learning';
import { Button, ButtonLink, Card, LinearProgress } from '@/components/ui';
import { ResourceView } from '@/components/ui/states';

/**
 * V2 Daily Learning home — "what should I do today". READS today's plan on load (never auto-generates); an explicit
 * "plan my day" action POSTs the generator (idempotent per local day, one main new point per day). The single next
 * action (repair > review > learn > done) routes into the REAL Teaching/Review flows. All progress/attention is
 * backend-authoritative — nothing is fabricated here. Learner-language throughout (no engine/internal concepts).
 */
// `null` is a valid loaded state (no plan generated yet), so wrap it — ResourceView reads a bare `null` as "loading".
interface TodayData { view: DailyView | null }

export default function TodayPage() {
  const t = useT();
  const res = useResource(useCallback(() => fetchMyToday().then((view) => ({ view })), []), []);

  return (
    <ResourceView loading={res.loading} error={res.error} data={res.data} onRetry={res.reload}>
      {(d) => (
        <div className="space-y-6">
          <header>
            <h1 className="text-2xl font-bold tracking-tight">{t('learner.daily.title')}</h1>
            <p className="mt-0.5 text-muted">{t('learner.daily.subtitle')}</p>
          </header>
          {d.view === null ? <PlanCta setData={res.setData} /> : <DailyBody view={d.view} />}
        </div>
      )}
    </ResourceView>
  );
}

/** No plan yet — an explicit generate action (never auto-POST on load). A 409 (no subject/roadmap) is a truthful state. */
function PlanCta({ setData }: { setData: (u: (prev: TodayData | null) => TodayData | null) => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function plan() {
    setError(null);
    setBusy(true);
    try {
      const view = await generateMyToday();
      setData(() => ({ view })); // the POST result IS the new state
    } catch (e) {
      if (!isAbortError(e)) setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">{t('learner.daily.planTitle')}</h2>
      <p className="mt-1 text-muted">{t('learner.daily.planBody')}</p>
      {error != null && (
        <p role="alert" className="mt-3 rounded-control border border-border bg-surface-2 px-3.5 py-2.5 text-sm text-text">{describeError(error, t)}</p>
      )}
      <div className="mt-4">
        <Button onClick={plan} loading={busy} disabled={busy}>{t('learner.daily.planCta')}</Button>
      </div>
    </Card>
  );
}

function DailyBody({ view }: { view: DailyView }) {
  const t = useT();
  return (
    <>
      {view.done ? <DoneCard /> : <MainAction view={view} />}
      {view.attention.length > 0 && <AttentionList items={view.attention} />}
      <ProgressCard view={view} />
    </>
  );
}

/** The one next action for today. LEARN/REPAIR route into teaching; REVIEW starts a review session. */
function MainAction({ view }: { view: DailyView }) {
  const t = useT();
  const { action } = view;
  const point = action.point;
  if (!point) return <DoneCard />;

  const isRepair = action.type === 'REPAIR';
  const isReview = action.type === 'REVIEW';
  const eyebrow = isRepair ? t('learner.daily.repairEyebrow') : isReview ? t('learner.daily.reviewEyebrow') : t('learner.daily.mainGoalEyebrow');
  const accent = isRepair ? 'border-l-warning' : isReview ? 'border-l-primary' : 'border-l-primary';

  return (
    <Card className={`border-l-4 p-6 ${accent}`}>
      <div className="flex items-center gap-2">
        <FiTarget aria-hidden className="text-primary" />
        <span className="text-xs font-bold uppercase tracking-wide text-primary">{eyebrow}</span>
        {view.mainGoal?.estimatedEffortMin != null && !isRepair && !isReview && (
          <span className="inline-flex items-center gap-1 text-xs text-muted"><FiClock aria-hidden /> {t('learner.daily.effort', { min: view.mainGoal.estimatedEffortMin })}</span>
        )}
      </div>
      <h2 className="mt-2 text-xl font-semibold text-text">{point.title}</h2>

      {/* Why Izlan chose this — always explainable, in learner language. */}
      <div className="mt-3 rounded-control border border-border bg-surface-2 p-3.5">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">{t('learner.daily.whyTitle')}</div>
        <p className="mt-1 text-sm text-text">{whyCopy(t, action)}</p>
      </div>

      {/* For a new learning goal, surface what the learner will be able to do. */}
      {!isRepair && !isReview && (view.mainGoal?.canDo.length ?? 0) > 0 && (
        <ul className="mt-3 space-y-1">
          {view.mainGoal!.canDo.map((c, i) => (
            <li key={i} className="flex gap-2 text-sm text-muted"><FiCheckCircle aria-hidden className="mt-0.5 shrink-0 text-success/70" /><span>{c}</span></li>
          ))}
        </ul>
      )}

      <div className="mt-5 flex justify-end">
        {isReview && action.skill ? (
          <ReviewButton pointId={point.roadmapPointId} skillId={action.skill.id} label={t('learner.daily.reviewCta')} />
        ) : (
          <ButtonLink href={`/teaching/${point.roadmapPointId}`} leftIcon={<FiArrowRight aria-hidden />}>
            {isRepair ? t('learner.daily.repairCta') : t('learner.daily.learnCta')}
          </ButtonLink>
        )}
      </div>
    </Card>
  );
}

function DoneCard() {
  const t = useT();
  return (
    <Card className="p-6">
      <div className="flex items-center gap-2">
        <FiCheckCircle className="text-success" aria-hidden />
        <h2 className="text-lg font-semibold">{t('learner.daily.doneTitle')}</h2>
      </div>
      <p className="mt-1 text-muted">{t('learner.daily.doneBody')}</p>
    </Card>
  );
}

/** Acquired points that currently need attention (repair/review) — shown alongside today's main action. */
function AttentionList({ items }: { items: DailyAttention[] }) {
  const t = useT();
  return (
    <Card className="p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{t('learner.daily.attentionTitle')}</h2>
      <ul className="mt-3 space-y-3">
        {items.map((a) => {
          const isRepair = a.attention === 'REPAIR_REQUIRED';
          const Icon = isRepair ? FiAlertTriangle : FiRefreshCw;
          const cls = isRepair ? 'text-warning' : 'text-primary';
          return (
            <li key={a.roadmapPointId} className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><Icon aria-hidden className={cls} /><span className={`text-xs font-semibold ${cls}`}>{isRepair ? t('learner.daily.repairBadge') : t('learner.daily.reviewBadge')}</span></div>
                <div className="mt-1 font-medium text-text">{a.title}</div>
                {a.attentionReason && a.attentionSkill && <p className="text-sm text-muted">{reasonCopy(t, a.attentionReason, a.attentionSkill.name)}</p>}
              </div>
              {isRepair ? (
                <ButtonLink href={`/teaching/${a.roadmapPointId}`} variant="secondary" size="sm" className="shrink-0">{t('learner.daily.repairCta')}</ButtonLink>
              ) : a.attentionSkill ? (
                <ReviewButton pointId={a.roadmapPointId} skillId={a.attentionSkill.id} label={t('learner.daily.reviewCta')} variant="secondary" size="sm" />
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ProgressCard({ view }: { view: DailyView }) {
  const t = useT();
  const { roadmapAcquired, roadmapTotal } = view.progress;
  const bp = roadmapTotal > 0 ? Math.round((roadmapAcquired / roadmapTotal) * 10000) : 0;
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t('learner.daily.progressTitle')}</h2>
        <span className="text-sm text-muted">{view.subject.title}</span>
      </div>
      <div className="mt-3"><LinearProgress value={bp} max={10000} showValue /></div>
      <p className="mt-2 text-sm text-muted">{t('learner.daily.progressText', { acquired: roadmapAcquired, total: roadmapTotal })}</p>
    </Card>
  );
}

/** Starts (or resumes) a point-scoped review, then routes into the existing review-session runner. */
function ReviewButton({ pointId, skillId, label, variant = 'primary', size }: { pointId: string; skillId: string; label: string; variant?: 'primary' | 'secondary'; size?: 'sm' | 'md' | 'lg' }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await startPointReview(pointId, skillId);
      router.push(`/review-session/${session.id}`);
    } catch (e) {
      setError(describeError(e, t));
      setBusy(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Button type="button" variant={variant} size={size} loading={busy} disabled={busy} onClick={go}>
        {busy ? t('learner.daily.reviewStarting') : label}
      </Button>
      {error && <p role="alert" className="text-xs font-medium text-danger">{error}</p>}
    </div>
  );
}

/** Learner-language "why this action" — never engine jargon. */
function whyCopy(t: TFunc, action: DailyAction): string {
  if (action.type === 'REPAIR') return action.reason && action.skill ? reasonCopy(t, action.reason, action.skill.name) : t('learner.daily.why.repair');
  if (action.type === 'REVIEW') return action.reason && action.skill ? reasonCopy(t, action.reason, action.skill.name) : t('learner.daily.why.review');
  return t('learner.daily.why.learn');
}

/** Learner-language explanation of WHY a skill needs attention (shared vocabulary with the V2 roadmap). */
function reasonCopy(t: TFunc, reason: DailyAttentionReason, skillName: string): string {
  const key =
    reason === 'REPEATED_MISTAKE'
      ? 'learner.v2.attention.reasonRepeatedMistake'
      : reason === 'PERSISTENT_WEAKNESS'
        ? 'learner.v2.attention.reasonWeakness'
        : 'learner.v2.attention.reasonRetention';
  return t(key, { skill: skillName });
}
