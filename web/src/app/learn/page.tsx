'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FiCalendar, FiCheckCircle } from 'react-icons/fi';
import { useT } from '@/lib/i18n/i18n-context';
import { useResource } from '@/lib/hooks/use-resource';
import { fetchProfile } from '@/lib/api/profile';
import { fetchLearningIntents, fetchOnboardingStatus } from '@/lib/api/onboarding';
import { fetchActiveRoadmap } from '@/lib/api/roadmap';
import { fetchTodayPlan, generateTodayPlan } from '@/lib/api/daily-plan';
import { isAbortError } from '@/lib/api/errors';
import { describeError } from '@/lib/ui/error-text';
import type { DailyPlan, LearningIntent, LearnerProfile, OnboardingStatus, RoadmapProgress } from '@/lib/api/types';
import { Button, ButtonLink, Card, LinearProgress, Select, Spinner } from '@/components/ui';
import { ResourceView } from '@/components/ui/states';

interface HomeData {
  profile: LearnerProfile;
  status: OnboardingStatus;
  intents: LearningIntent[]; // complete (track-carrying) intents when any exist
  selected: LearningIntent | null;
  roadmap: RoadmapProgress | null;
  today: DailyPlan | null;
}

/**
 * Read-only Home composition (§9-26). Loads profile + onboarding status + intents, then — for the UI-selected subject —
 * the active roadmap and today's plan as READS only. It NEVER calls the daily-plan generator on load (§20/§23): the
 * page must not mutate learning state. Subject selection (§12/§15) is UI context only (component state; not persisted).
 */
async function loadHome(subjectId: string | null): Promise<HomeData> {
  const [profile, status, allIntents] = await Promise.all([fetchProfile(), fetchOnboardingStatus(), fetchLearningIntents()]);
  const withTrack = allIntents.filter((i) => i.track);
  const pool = withTrack.length ? withTrack : allIntents;
  const selected = pool.find((i) => i.subject.id === subjectId) ?? pool[0] ?? null;
  let roadmap: RoadmapProgress | null = null;
  let today: DailyPlan | null = null;
  if (status.completed && selected?.track) {
    roadmap = await fetchActiveRoadmap(selected.subject.id); // null on ROADMAP_NOT_FOUND (an ordinary state, not an error)
    if (roadmap) today = await fetchTodayPlan(); // null on DAILY_PLAN_NOT_FOUND (no plan generated yet)
  }
  return { profile, status, intents: pool, selected, roadmap, today };
}

export default function HomePage() {
  const t = useT();
  const router = useRouter();
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const res = useResource(useCallback(() => loadHome(subjectId), [subjectId]), [subjectId]);

  // State A — a learner who has not completed onboarding never sees a partial Home (§11/§13).
  useEffect(() => {
    if (res.data && !res.data.status.completed) router.replace('/onboarding');
  }, [res.data, router]);

  return (
    <ResourceView loading={res.loading} error={res.error} data={res.data} onRetry={res.reload}>
      {(d) => {
        if (!d.status.completed) {
          return (
            <div className="grid min-h-[50vh] place-items-center" role="status" aria-live="polite">
              <Spinner label={t('learner.common.loading')} />
            </div>
          );
        }
        const name = d.profile.displayName?.trim();
        return (
          <div className="space-y-6">
            <header className="flex flex-wrap items-end justify-between gap-3">
              <h1 className="text-2xl font-bold tracking-tight">
                {name ? t('learner.dashboard.greeting', { name }) : t('learner.dashboard.greetingNoName')}
              </h1>
              {d.intents.length > 1 && d.selected && (
                <label className="flex items-center gap-2 text-sm text-muted">
                  <span>{t('learner.dashboard.subjectLabel')}</span>
                  <Select
                    aria-label={t('learner.dashboard.subjectLabel')}
                    value={d.selected.subject.id}
                    onChange={(e) => setSubjectId(e.target.value)}
                    className="h-9 w-auto"
                  >
                    {d.intents.map((i) => (
                      <option key={i.subject.id} value={i.subject.id}>{i.subject.title}</option>
                    ))}
                  </Select>
                </label>
              )}
            </header>

            {!d.roadmap ? (
              <PlacementCta intent={d.selected} />
            ) : (
              <>
                <RoadmapSummary roadmap={d.roadmap} />
                <TodaySection initial={d.today} setData={res.setData} />
              </>
            )}
          </div>
        );
      }}
    </ResourceView>
  );
}

/** State B — completed onboarding but no active roadmap: a calm placement CTA (§13). Never generates a roadmap here. */
function PlacementCta({ intent }: { intent: LearningIntent | null }) {
  const t = useT();
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">{t('learner.dashboard.placementTitle')}</h2>
      <p className="mt-1 text-muted">{t('learner.dashboard.placementBody')}</p>
      {intent && (
        <div className="mt-4">
          <ButtonLink href={`/placement?learningIntentId=${encodeURIComponent(intent.id)}`}>
            {t('learner.dashboard.placementCta')}
          </ButtonLink>
        </div>
      )}
    </Card>
  );
}

/** Roadmap summary — backend progressBp is the single progress authority (§17/§19); next step comes from nextItemId (§18/§20). */
function RoadmapSummary({ roadmap }: { roadmap: RoadmapProgress }) {
  const t = useT();
  const next = roadmap.nextItemId ? roadmap.items.find((i) => i.id === roadmap.nextItemId) : null;
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t('learner.dashboard.roadmapTitle')}</h2>
        <ButtonLink href={`/learn/roadmap?subject=${encodeURIComponent(roadmap.subjectId)}`} variant="ghost" size="sm">
          {t('learner.dashboard.viewRoadmap')}
        </ButtonLink>
      </div>
      <div className="mt-3">
        <LinearProgress value={roadmap.progress.progressBp} max={10000} showValue />
      </div>
      <p className="mt-2 text-sm text-muted">
        {t('learner.dashboard.roadmapProgress', { completed: roadmap.progress.completed, total: roadmap.progress.total })}
      </p>
      {next && (
        <div className="mt-4 rounded-control border border-border bg-surface-2 p-3.5">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">{t('learner.dashboard.nextStep')}</div>
          <div className="mt-1.5 flex items-center justify-between gap-3">
            <span className="min-w-0 truncate font-medium text-text">{next.lesson.title ?? t('learner.roadmap.untitled')}</span>
            {/* Phase 04: lessons start from today's plan (the entry authority) — guide to Learning, never bypass it. */}
            <ButtonLink href="/learn/learning" size="sm">{t('learner.dashboard.startLesson')}</ButtonLink>
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * Today section — states C/D/E/F. READ result comes in via `initial`; generation is an explicit learner action only.
 * The POST response becomes the authoritative UI state (§23). No "next Topic" after completion (§22/§24).
 */
function TodaySection({ initial, setData }: { initial: DailyPlan | null; setData: (u: (prev: HomeData | null) => HomeData | null) => void }) {
  const t = useT();
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<unknown>(null);

  async function generate() {
    setGenError(null);
    setGenerating(true);
    try {
      const plan = await generateTodayPlan(); // POST — server derives date/timezone/topic/items (§21)
      setData((prev) => (prev ? { ...prev, today: plan } : prev)); // the POST result IS the new state (§23)
    } catch (e) {
      if (!isAbortError(e)) setGenError(e); // may be DAILY_PLAN_NO_EXECUTABLE_CONTENT — a truthful state, not a network error
    } finally {
      setGenerating(false);
    }
  }

  // State C/F — no plan yet: an explicit generate action (never auto-POST). Errors are shown truthfully, with retry.
  if (!initial) {
    return (
      <Card className="p-6">
        <h2 className="text-lg font-semibold">{t('learner.dashboard.generateTitle')}</h2>
        <p className="mt-1 text-muted">{t('learner.dashboard.generateBody')}</p>
        {genError != null && (
          <p role="alert" className="mt-3 rounded-control border border-border bg-surface-2 px-3.5 py-2.5 text-sm text-text">
            {describeError(genError, t)}
          </p>
        )}
        <div className="mt-4">
          <Button onClick={generate} loading={generating} disabled={generating}>
            {t('learner.dashboard.generateCta')}
          </Button>
        </div>
      </Card>
    );
  }

  // State E — the plan is complete for today. Calm, and NO next-topic action (one Topic per local day, §22/§24).
  if (initial.done) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2">
          <FiCheckCircle className="text-success" aria-hidden />
          <h2 className="text-lg font-semibold">{t('learner.dashboard.doneTitle')}</h2>
        </div>
        <p className="mt-1 text-muted">{t('learner.dashboard.doneBody')}</p>
      </Card>
    );
  }

  // State D — render today's Topic + items. Progress is the backend's plan.progress (§25).
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t('learner.dashboard.todayTitle')}</h2>
        <span className="inline-flex items-center gap-1.5 text-sm text-muted">
          <FiCalendar aria-hidden /> {t('learner.dashboard.todayItems', { n: initial.items.length })}
        </span>
      </div>
      {initial.topic?.title && (
        <p className="mt-1 text-sm">
          <span className="text-muted">{t('learner.dashboard.todayTopic')}: </span>
          <span className="font-medium text-text">{initial.topic.title}</span>
        </p>
      )}
      <div className="mt-3">
        <LinearProgress value={initial.progress.progressBp} max={10000} showValue />
      </div>
      <p className="mt-2 text-sm text-muted">
        {t('learner.dashboard.todayProgress', { completed: initial.progress.completed, total: initial.progress.total })}
      </p>
      <ul className="mt-4 space-y-2">
        {initial.items.map((it) => (
          <li key={it.id} className="flex items-center justify-between gap-3 rounded-control border border-border bg-surface px-3.5 py-2.5 text-sm">
            <span className="min-w-0 truncate text-text">{it.lesson.title ?? it.skill?.name ?? t('learner.roadmap.untitled')}</span>
            <span className="shrink-0 rounded-md bg-surface-2 px-2 py-0.5 text-xs text-muted">{it.kind}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <ButtonLink href="/learn/learning" variant="secondary" size="sm">{t('learner.dashboard.openLearning')}</ButtonLink>
      </div>
    </Card>
  );
}
