'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FiCheckCircle, FiLock } from 'react-icons/fi';
import { useT } from '@/lib/i18n/i18n-context';
import { useResource } from '@/lib/hooks/use-resource';
import { fetchLearningIntents, fetchOnboardingStatus } from '@/lib/api/onboarding';
import { fetchActiveRoadmap } from '@/lib/api/roadmap';
import { fetchTodayPlan, generateTodayPlan } from '@/lib/api/daily-plan';
import { isAbortError } from '@/lib/api/errors';
import { describeError } from '@/lib/ui/error-text';
import type { DailyPlan, DailyPlanItem, LearningIntent, OnboardingStatus, RoadmapProgress } from '@/lib/api/types';
import { Button, ButtonLink, Card, LinearProgress, Spinner } from '@/components/ui';
import { ResourceView } from '@/components/ui/states';

interface LearningData {
  status: OnboardingStatus;
  selected: LearningIntent | null;
  roadmap: RoadmapProgress | null;
  today: DailyPlan | null;
}

/** Read-only load: onboarding status + intents, then (for the selected subject) roadmap + today's plan — READS only. */
async function loadLearning(): Promise<LearningData> {
  const [status, intents] = await Promise.all([fetchOnboardingStatus(), fetchLearningIntents()]);
  const withTrack = intents.filter((i) => i.track);
  const selected = withTrack[0] ?? intents[0] ?? null;
  let roadmap: RoadmapProgress | null = null;
  let today: DailyPlan | null = null;
  if (status.completed && selected?.track) {
    roadmap = await fetchActiveRoadmap(selected.subject.id);
    if (roadmap) today = await fetchTodayPlan();
  }
  return { status, selected, roadmap, today };
}

export default function LearningPage() {
  const t = useT();
  const router = useRouter();
  const res = useResource(useCallback(loadLearning, []), []);

  useEffect(() => {
    if (res.data && !res.data.status.completed) router.replace('/onboarding');
  }, [res.data, router]);

  return (
    <ResourceView loading={res.loading} error={res.error} data={res.data} onRetry={res.reload}>
      {(d) => {
        if (!d.status.completed) {
          return <div className="grid min-h-[50vh] place-items-center" role="status" aria-live="polite"><Spinner label={t('learner.common.loading')} /></div>;
        }
        return (
          <div className="space-y-6">
            <header>
              <h1 className="text-2xl font-bold tracking-tight">{t('learner.learning.title')}</h1>
              <p className="mt-0.5 text-muted">{t('learner.learning.subtitle')}</p>
            </header>

            {!d.roadmap ? (
              <PlacementCta intent={d.selected} />
            ) : !d.today ? (
              <GenerateSection setData={res.setData} />
            ) : (
              <TodayWorkspace today={d.today} />
            )}
          </div>
        );
      }}
    </ResourceView>
  );
}

function PlacementCta({ intent }: { intent: LearningIntent | null }) {
  const t = useT();
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">{t('learner.dashboard.placementTitle')}</h2>
      <p className="mt-1 text-muted">{t('learner.dashboard.placementBody')}</p>
      {intent && (
        <div className="mt-4">
          <ButtonLink href={`/placement?learningIntentId=${encodeURIComponent(intent.id)}`}>{t('learner.dashboard.placementCta')}</ButtonLink>
        </div>
      )}
    </Card>
  );
}

/** No plan yet — explicit generation (never auto-POST on load). Mirrors the Home pattern. */
function GenerateSection({ setData }: { setData: (u: (prev: LearningData | null) => LearningData | null) => void }) {
  const t = useT();
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<unknown>(null);
  async function generate() {
    setGenError(null);
    setGenerating(true);
    try {
      const plan = await generateTodayPlan();
      setData((prev) => (prev ? { ...prev, today: plan } : prev));
    } catch (e) {
      if (!isAbortError(e)) setGenError(e);
    } finally {
      setGenerating(false);
    }
  }
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">{t('learner.dashboard.generateTitle')}</h2>
      <p className="mt-1 text-muted">{t('learner.dashboard.generateBody')}</p>
      {genError != null && (
        <p role="alert" className="mt-3 rounded-control border border-border bg-surface-2 px-3.5 py-2.5 text-sm text-text">{describeError(genError, t)}</p>
      )}
      <div className="mt-4">
        <Button onClick={generate} loading={generating} disabled={generating}>{t('learner.dashboard.generateCta')}</Button>
      </div>
    </Card>
  );
}

function TodayWorkspace({ today }: { today: DailyPlan }) {
  const t = useT();
  const core = today.items.filter((i) => i.kind !== 'EXTRA');
  const extra = today.items.filter((i) => i.kind === 'EXTRA');
  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{today.topic?.title ?? t('learner.learning.title')}</h2>
          <span className="text-sm text-muted">{t('learner.dashboard.todayProgress', { completed: today.progress.completed, total: today.progress.total })}</span>
        </div>
        <div className="mt-3"><LinearProgress value={today.progress.progressBp} max={10000} showValue /></div>
      </Card>

      {today.done ? (
        <Card className="p-6">
          <div className="flex items-center gap-2">
            <FiCheckCircle className="text-success" aria-hidden />
            <h2 className="text-lg font-semibold">{t('learner.dashboard.doneTitle')}</h2>
          </div>
          <p className="mt-1 text-muted">{t('learner.dashboard.doneBody')}</p>
        </Card>
      ) : (
        <ul className="space-y-2.5">
          {core.map((item) => <LessonRow key={item.id} item={item} />)}
        </ul>
      )}

      {extra.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{t('learner.learning.sectionExtra')}</h3>
          <ul className="space-y-2.5">{extra.map((item) => <ReviewRow key={item.id} item={item} />)}</ul>
        </section>
      )}
    </div>
  );
}

/** One core lesson item. Start/Continue navigates to the runner; state comes from the backend (never client-derived). */
function LessonRow({ item }: { item: DailyPlanItem }) {
  const t = useT();
  const title = item.lesson.title ?? t('learner.roadmap.untitled');
  return (
    <li className="flex items-center justify-between gap-3 rounded-panel border border-border bg-surface px-4 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {item.state === 'COMPLETED' && <FiCheckCircle className="shrink-0 text-success" aria-hidden />}
        {item.state === 'BLOCKED' && <FiLock className="shrink-0 text-muted" aria-hidden />}
        <span className="min-w-0 truncate font-medium text-text">{title}</span>
      </div>
      {item.state === 'AVAILABLE' && <ButtonLink href={`/lesson/${item.id}`} size="sm">{t('learner.learning.start')}</ButtonLink>}
      {item.state === 'IN_PROGRESS' && <ButtonLink href={`/lesson/${item.id}`} size="sm">{t('learner.learning.continue')}</ButtonLink>}
      {item.state === 'COMPLETED' && <span className="shrink-0 text-xs font-medium text-success">{t('learner.learning.completed')}</span>}
      {item.state === 'BLOCKED' && <span className="shrink-0 text-xs font-medium text-muted">{t('learner.learning.locked')}</span>}
      {(item.state === 'UNAVAILABLE' || item.state == null) && <span className="shrink-0 text-xs font-medium text-muted">{t('learner.learning.unavailable')}</span>}
    </li>
  );
}

/** A review EXTRA item — no roadmap state; links to the Review flow (§25). */
function ReviewRow({ item }: { item: DailyPlanItem }) {
  const t = useT();
  return (
    <li className="flex items-center justify-between gap-3 rounded-panel border border-border bg-surface px-4 py-3">
      <span className="min-w-0 truncate font-medium text-text">{item.skill?.name ?? item.lesson.title ?? t('learner.learning.reviewCta')}</span>
      <ButtonLink href="/learn/review" size="sm" variant="secondary">{t('learner.learning.reviewCta')}</ButtonLink>
    </li>
  );
}
