'use client';

import { Suspense, useCallback, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FiAlertTriangle, FiArrowRight, FiCheckCircle, FiCircle, FiLock, FiPlayCircle, FiRefreshCw } from 'react-icons/fi';
import { useT, type TFunc } from '@/lib/i18n/i18n-context';
import { useResource } from '@/lib/hooks/use-resource';
import { describeError } from '@/lib/ui/error-text';
import { fetchLearningIntents } from '@/lib/api/onboarding';
import { fetchV2Focus, fetchV2Roadmap, startPointReview, type V2Focus, type V2Roadmap, type V2RoadmapPoint } from '@/lib/api/v2-learning';
import type { LearningIntent } from '@/lib/api/types';
import { Button, ButtonLink, Card, Select, Spinner } from '@/components/ui';
import { ResourceView } from '@/components/ui/states';

/**
 * Generic learner Roadmap — the personalized V2 progression for ANY subject/track (not the pilot). It shows the
 * single most useful next action (repair > review > continue), then the ordered roadmap points with their derived
 * state (LEARNED / VALIDATED / IN_PROGRESS / LOCKED / REPAIR_REQUIRED / REVIEW_DUE), effort and outcomes — every
 * CTA keyed on the stable `roadmapPointId`. Any currently-teachable published point is enterable, not just one.
 */
interface RoadmapData {
  intents: LearningIntent[];
  selected: LearningIntent | null;
  roadmap: V2Roadmap | null;
  focus: V2Focus | null;
}

async function loadRoadmap(subjectId: string | null): Promise<RoadmapData> {
  const all = await fetchLearningIntents();
  const withTrack = all.filter((i) => i.track);
  const pool = withTrack.length ? withTrack : all;
  const selected = pool.find((i) => i.subject.id === subjectId) ?? pool[0] ?? null;
  if (!selected) return { intents: pool, selected: null, roadmap: null, focus: null };
  const [roadmap, focus] = await Promise.all([fetchV2Roadmap(selected.subject.id), fetchV2Focus(selected.subject.id).catch(() => null)]);
  return { intents: pool, selected, roadmap, focus };
}

/** Learner-language explanation of WHY a point needs attention (never engine jargon). */
function reasonCopy(t: TFunc, reason: V2RoadmapPoint['attentionReason'], skillName: string): string {
  const key =
    reason === 'REPEATED_MISTAKE'
      ? 'learner.v2.attention.reasonRepeatedMistake'
      : reason === 'PERSISTENT_WEAKNESS'
        ? 'learner.v2.attention.reasonWeakness'
        : 'learner.v2.attention.reasonRetention';
  return t(key, { skill: skillName });
}

export default function RoadmapPage() {
  return (
    <Suspense fallback={<div className="grid min-h-[50vh] place-items-center"><Spinner /></div>}>
      <RoadmapInner />
    </Suspense>
  );
}

function RoadmapInner() {
  const t = useT();
  const params = useSearchParams();
  const [subjectId, setSubjectId] = useState<string | null>(params.get('subject'));
  const res = useResource(useCallback(() => loadRoadmap(subjectId), [subjectId]), [subjectId]);

  return (
    <ResourceView loading={res.loading} error={res.error} data={res.data} onRetry={res.reload}>
      {(d) => (
        <div className="space-y-6">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{t('learner.roadmap.title')}</h1>
              <p className="mt-0.5 text-muted">{d.selected?.subject.title ?? t('learner.roadmap.subtitle')}</p>
            </div>
            <div className="flex items-center gap-3">
              {d.intents.length > 1 && d.selected && (
                <label className="flex items-center gap-2 text-sm text-muted">
                  <span className="sr-only sm:not-sr-only">{t('learner.roadmap.subjectLabel')}</span>
                  <Select aria-label={t('learner.roadmap.subjectLabel')} value={d.selected.subject.id} onChange={(e) => setSubjectId(e.target.value)} className="h-9 w-auto">
                    {d.intents.map((i) => (
                      <option key={i.subject.id} value={i.subject.id}>{i.subject.title}</option>
                    ))}
                  </Select>
                </label>
              )}
              <ButtonLink href="/learn/today" variant="secondary" size="sm">{t('learner.daily.openToday')}</ButtonLink>
            </div>
          </header>

          {d.focus && <FocusBanner focus={d.focus} />}

          {!d.roadmap || d.roadmap.points.length === 0 ? (
            <Card className="p-6"><p className="text-muted">{t('learner.v2.empty')}</p></Card>
          ) : (
            <ol className="space-y-4">
              {d.roadmap.points.map((p) => (
                <li key={p.roadmapPointId}><PointCard point={p} /></li>
              ))}
            </ol>
          )}
        </div>
      )}
    </ResourceView>
  );
}

/** The single most useful next action, decided server-side from current evidence (repair > review > continue). */
function FocusBanner({ focus }: { focus: V2Focus }) {
  const t = useT();
  if (!focus.point || focus.action === 'DONE') {
    return (
      <Card className="p-5">
        <p className="font-semibold text-text">{t('learner.v2.focus.doneTitle')}</p>
        <p className="mt-0.5 text-sm text-muted">{t('learner.v2.focus.doneBody')}</p>
      </Card>
    );
  }
  const p = focus.point;
  const isRepair = focus.action === 'REPAIR';
  const isReview = focus.action === 'REVIEW';
  const eyebrow = isRepair ? t('learner.v2.focus.repairTitle') : isReview ? t('learner.v2.focus.reviewTitle') : t('learner.v2.focus.continueTitle');
  const accent = isRepair ? 'text-warning' : isReview ? 'text-primary' : 'text-text';

  return (
    <Card className={`border-l-4 p-5 ${isRepair ? 'border-l-warning' : isReview ? 'border-l-primary' : 'border-l-border'}`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <span className={`text-xs font-bold uppercase tracking-wide ${accent}`}>{eyebrow}</span>
          <h2 className="mt-1 text-lg font-semibold text-text">{p.title}</h2>
          {(isRepair || isReview) && focus.reason && focus.skill && <p className="mt-1 text-sm text-muted">{reasonCopy(t, focus.reason, focus.skill.name)}</p>}
        </div>
        {isReview && focus.skill ? (
          <ReviewButton pointId={p.roadmapPointId} skillId={focus.skill.id} label={t('learner.v2.focus.reviewCta')} variant="primary" />
        ) : (
          <ButtonLink href={`/teaching/${p.roadmapPointId}`} variant="primary" leftIcon={<FiArrowRight aria-hidden />} className="shrink-0">
            {isRepair ? t('learner.v2.focus.repairCta') : t('learner.v2.focus.continueCta')}
          </ButtonLink>
        )}
      </div>
    </Card>
  );
}

function PointCard({ point }: { point: V2RoadmapPoint }) {
  const t = useT();
  const canDo = point.learningOutcome?.canDo ?? [];
  const locked = point.availability === 'LOCKED' || point.availability === 'CONTENT_UNAVAILABLE';
  const repair = point.attention === 'REPAIR_REQUIRED';
  const reviewDue = point.attention === 'REVIEW_DUE';

  const state = repair
    ? { icon: FiAlertTriangle, cls: 'text-warning', label: t('learner.v2.attention.repairBadge') }
    : reviewDue
      ? { icon: FiRefreshCw, cls: 'text-primary', label: t('learner.v2.attention.reviewBadge') }
      : point.learned
        ? { icon: FiCheckCircle, cls: 'text-success', label: t('learner.v2.stateLearned') }
        : point.validated
          ? { icon: FiCheckCircle, cls: 'text-success', label: t('learner.v2.stateValidated') }
          : point.availability === 'IN_PROGRESS'
            ? { icon: FiPlayCircle, cls: 'text-primary', label: t('learner.v2.stateInProgress') }
            : locked
              ? { icon: FiLock, cls: 'text-muted', label: t('learner.v2.stateLocked') }
              : { icon: FiCircle, cls: 'text-text', label: t('learner.v2.stateAvailable') };
  const Icon = state.icon;
  const normalCta = point.learned
    ? t('learner.v2.review')
    : point.validated
      ? t('learner.v2.practiceAnyway')
      : point.availability === 'IN_PROGRESS'
        ? t('learner.v2.continue')
        : t('learner.v2.start');

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Icon aria-hidden className={`text-lg ${state.cls}`} />
            <span className={`text-xs font-semibold ${state.cls}`}>{state.label}</span>
            {point.estimatedEffortMin != null && <span className="text-xs text-muted">· {t('learner.v2.minutes', { min: point.estimatedEffortMin })}</span>}
          </div>
          <h2 className="mt-2 text-lg font-semibold">{point.title}</h2>
          {(repair || reviewDue) && point.attentionReason && point.attentionSkill ? (
            <p className="mt-2 text-sm text-muted">{reasonCopy(t, point.attentionReason, point.attentionSkill.name)}</p>
          ) : (
            canDo.length > 0 && (
              <ul className="mt-2 space-y-1">
                {canDo.map((c, i) => (
                  <li key={i} className="flex gap-2 text-sm text-muted">
                    <FiCheckCircle aria-hidden className="mt-0.5 shrink-0 text-success/70" />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            )
          )}
          {point.validated && !point.learned && point.attention === 'NONE' && <p className="mt-2 text-xs text-muted">{t('learner.v2.validatedNote')}</p>}
        </div>

        {repair ? (
          <ButtonLink href={`/teaching/${point.roadmapPointId}`} variant="primary" className="shrink-0">{t('learner.v2.attention.repairCta')}</ButtonLink>
        ) : reviewDue && point.attentionSkill ? (
          <ReviewButton pointId={point.roadmapPointId} skillId={point.attentionSkill.id} label={t('learner.v2.attention.reviewCta')} variant="primary" />
        ) : (
          !locked && (
            <ButtonLink href={`/teaching/${point.roadmapPointId}`} variant={point.learned || point.validated ? 'secondary' : 'primary'} className="shrink-0">
              {normalCta}
            </ButtonLink>
          )
        )}
      </div>
    </Card>
  );
}

/** Starts (or resumes) a point-scoped review, then routes into the existing review-session runner. */
function ReviewButton({ pointId, skillId, label, variant }: { pointId: string; skillId: string; label: string; variant: 'primary' | 'secondary' }) {
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
      <Button type="button" variant={variant} loading={busy} disabled={busy} onClick={go}>
        {busy ? t('learner.v2.attention.starting') : label}
      </Button>
      {error && <p role="alert" className="text-xs font-medium text-danger">{error}</p>}
    </div>
  );
}
