'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { FiArrowRight, FiCalendar, FiCompass, FiSettings } from 'react-icons/fi';
import { useT } from '@/lib/i18n/i18n-context';
import { useResource } from '@/lib/hooks/use-resource';
import { fetchProfile } from '@/lib/api/profile';
import { fetchLearningIntents, fetchOnboardingStatus } from '@/lib/api/onboarding';
import { fetchActiveRoadmap } from '@/lib/api/roadmap';
import { fetchTodayPlan } from '@/lib/api/daily-plan';
import type { DailyPlan, LearningIntent, LearnerProfile, OnboardingStatus, RoadmapProgress } from '@/lib/api/types';
import { Button, Card } from '@/components/ui';
import { ResourceView } from '@/components/ui/states';

interface DashboardData {
  profile: LearnerProfile;
  status: OnboardingStatus;
  intent: LearningIntent | null;
  roadmap: RoadmapProgress | null;
  today: DailyPlan | null;
}

/** Read-only dashboard composition (§34): profile + onboarding status + intents, then roadmap + today plan READS only.
 *  It NEVER calls POST /daily-plans/today — a page load must not mutate learning state. */
async function loadDashboard(): Promise<DashboardData> {
  const [profile, status, intents] = await Promise.all([fetchProfile(), fetchOnboardingStatus(), fetchLearningIntents()]);
  const intent = intents.find((i) => i.track) ?? intents[0] ?? null;
  let roadmap: RoadmapProgress | null = null;
  let today: DailyPlan | null = null;
  if (status.completed && intent?.track) {
    roadmap = await fetchActiveRoadmap(intent.subject.id);
    if (roadmap) today = await fetchTodayPlan();
  }
  return { profile, status, intent, roadmap, today };
}

function StateCard({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-muted">{body}</p>
      {children && <div className="mt-4">{children}</div>}
    </Card>
  );
}

export default function DashboardPage() {
  const t = useT();
  const res = useResource(useCallback(loadDashboard, []), []);

  return (
    <ResourceView loading={res.loading} error={res.error} data={res.data} onRetry={res.reload}>
      {(d) => {
        const name = d.profile.displayName?.trim();
        return (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{name ? t('learner.dashboard.greeting', { name }) : t('learner.dashboard.greetingNoName')}</h1>
            </div>

            {/* State A — onboarding incomplete */}
            {!d.status.completed ? (
              <StateCard title={t('learner.dashboard.continueSetupTitle')} body={t('learner.dashboard.continueSetupBody')}>
                <Link href="/onboarding">
                  <Button leftIcon={<FiSettings aria-hidden />}>{t('learner.dashboard.continueSetupCta')}</Button>
                </Link>
              </StateCard>
            ) : (
              <>
                {/* Selected subject / track */}
                {d.intent && (
                  <Card className="p-6">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{t('learner.dashboard.yourLearning')}</h2>
                    <div className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-2">
                      <div>
                        <div className="text-xs text-muted">{t('learner.dashboard.subject')}</div>
                        <div className="font-medium text-text">{d.intent.subject.title}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted">{t('learner.dashboard.track')}</div>
                        <div className="font-medium text-text">{d.intent.track?.title ?? '—'}</div>
                      </div>
                      <Link href="/learn/subjects" className="ml-auto text-sm text-primary hover:underline">
                        {t('learner.dashboard.manageSubjects')}
                      </Link>
                    </div>
                  </Card>
                )}

                {/* State B — no active roadmap */}
                {!d.roadmap ? (
                  <StateCard title={t('learner.dashboard.noRoadmapTitle')} body={t('learner.dashboard.noRoadmapBody')}>
                    <span className="inline-flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5 text-sm text-muted">
                      <FiCompass aria-hidden /> {t('learner.dashboard.comingSoon')}
                    </span>
                  </StateCard>
                ) : (
                  <>
                    {/* Roadmap summary */}
                    <Card className="p-6">
                      <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold">{t('learner.dashboard.roadmapTitle')}</h2>
                        <span className="text-sm text-muted">{t('learner.dashboard.roadmapProgress', { completed: d.roadmap.progress.completed, total: d.roadmap.progress.total })}</span>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(d.roadmap.progress.progressBp / 100)}%` }} />
                      </div>
                    </Card>

                    {/* State C/D — today's plan */}
                    {!d.today ? (
                      <StateCard title={t('learner.dashboard.noTodayTitle')} body={t('learner.dashboard.noTodayBody')} />
                    ) : (
                      <Card className="p-6">
                        <div className="flex items-center justify-between">
                          <h2 className="text-lg font-semibold">{t('learner.dashboard.todayTitle')}</h2>
                          <span className="inline-flex items-center gap-1.5 text-sm text-muted">
                            <FiCalendar aria-hidden /> {t('learner.dashboard.todayItems', { n: d.today.items.length })}
                          </span>
                        </div>
                        {d.today.topic?.title && <p className="mt-1 text-muted">{d.today.topic.title}</p>}
                        <ul className="mt-4 space-y-2">
                          {d.today.items.slice(0, 6).map((it) => (
                            <li key={it.id} className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                              <span className="truncate text-text">{it.lesson.title ?? '—'}</span>
                              {/* Lesson execution is Phase 3.1 — clearly an upcoming action, never a broken link. */}
                              <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 text-xs text-muted">
                                <FiArrowRight aria-hidden /> {t('learner.dashboard.comingSoon')}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </Card>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        );
      }}
    </ResourceView>
  );
}
