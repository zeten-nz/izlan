'use client';

import { Suspense, useCallback, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FiCheckCircle, FiCircle, FiLock, FiMinusCircle, FiPlayCircle } from 'react-icons/fi';
import { useT } from '@/lib/i18n/i18n-context';
import { useResource } from '@/lib/hooks/use-resource';
import { fetchLearningIntents } from '@/lib/api/onboarding';
import { fetchActiveRoadmap } from '@/lib/api/roadmap';
import type { LearningIntent, RoadmapItem, RoadmapProgress } from '@/lib/api/types';
import { ButtonLink, Card, LinearProgress, Select, Spinner } from '@/components/ui';
import { ResourceView } from '@/components/ui/states';

interface RoadmapData {
  intents: LearningIntent[];
  selected: LearningIntent | null;
  roadmap: RoadmapProgress | null;
}

async function loadRoadmap(subjectId: string | null): Promise<RoadmapData> {
  const all = await fetchLearningIntents();
  const withTrack = all.filter((i) => i.track);
  const pool = withTrack.length ? withTrack : all;
  const selected = pool.find((i) => i.subject.id === subjectId) ?? pool[0] ?? null;
  const roadmap = selected?.track ? await fetchActiveRoadmap(selected.subject.id) : null; // null on ROADMAP_NOT_FOUND
  return { intents: pool, selected, roadmap };
}

// Backend item state → icon + i18n label. Every state carries text + a distinct icon (never color-only, §15/§17).
const STATE_META: Record<RoadmapItem['state'], { icon: typeof FiCircle; cls: string; key: string }> = {
  COMPLETED: { icon: FiCheckCircle, cls: 'text-success', key: 'stateCompleted' },
  IN_PROGRESS: { icon: FiPlayCircle, cls: 'text-primary', key: 'stateInProgress' },
  AVAILABLE: { icon: FiCircle, cls: 'text-text', key: 'stateAvailable' },
  BLOCKED: { icon: FiLock, cls: 'text-muted', key: 'stateBlocked' },
  UNAVAILABLE: { icon: FiMinusCircle, cls: 'text-muted', key: 'stateUnavailable' },
};

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
            {d.intents.length > 1 && d.selected && (
              <label className="flex items-center gap-2 text-sm text-muted">
                <span>{t('learner.roadmap.subjectLabel')}</span>
                <Select aria-label={t('learner.roadmap.subjectLabel')} value={d.selected.subject.id} onChange={(e) => setSubjectId(e.target.value)} className="h-9 w-auto">
                  {d.intents.map((i) => (
                    <option key={i.subject.id} value={i.subject.id}>{i.subject.title}</option>
                  ))}
                </Select>
              </label>
            )}
          </header>

          {!d.roadmap ? <PlacementCta intent={d.selected} /> : <RoadmapPath roadmap={d.roadmap} />}
        </div>
      )}
    </ResourceView>
  );
}

/** No active roadmap yet — a calm placement CTA (same product state as Home §13). */
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

function RoadmapPath({ roadmap }: { roadmap: RoadmapProgress }) {
  const t = useT();
  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{t('learner.roadmap.progressLabel')}</h2>
          <span className="text-sm text-muted">{t('learner.roadmap.progress', { completed: roadmap.progress.completed, total: roadmap.progress.total })}</span>
        </div>
        <div className="mt-3">
          <LinearProgress value={roadmap.progress.progressBp} max={10000} showValue />
        </div>
      </Card>

      {roadmap.items.length === 0 ? (
        <p className="text-sm text-muted">{t('learner.roadmap.emptyItems')}</p>
      ) : (
        <ol className="space-y-0">
          {roadmap.items.map((item, idx) => (
            <Milestone key={item.id} item={item} isNext={item.id === roadmap.nextItemId} last={idx === roadmap.items.length - 1} />
          ))}
        </ol>
      )}
    </div>
  );
}

function Milestone({ item, isNext, last }: { item: RoadmapItem; isNext: boolean; last: boolean }) {
  const t = useT();
  const meta = STATE_META[item.state];
  const Icon = meta.icon;
  return (
    <li className="relative flex gap-4 pb-5 last:pb-0">
      {/* Connector line between milestones. */}
      {!last && <span aria-hidden className="absolute bottom-0 left-4 top-9 w-px bg-border" />}
      <span className={`relative z-10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface ${meta.cls}`}>
        <Icon aria-hidden />
      </span>
      <div className={`min-w-0 flex-1 rounded-control border p-3.5 ${isNext ? 'border-primary bg-surface-2' : 'border-border bg-surface'}`}>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">{item.position}.</span>
          {isNext && <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{t('learner.roadmap.nextStep')}</span>}
        </div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <span className="min-w-0 truncate font-medium text-text">{item.lesson.title ?? t('learner.roadmap.untitled')}</span>
          <span className={`inline-flex shrink-0 items-center gap-1 text-xs font-medium ${meta.cls}`}>
            <Icon aria-hidden size={13} /> {t(`learner.roadmap.${meta.key}`)}
          </span>
        </div>
        {isNext && (
          <div className="mt-2.5">
            {/* Phase 04: lessons start from today's plan (the entry authority) — guide to Learning, never bypass it. */}
            <ButtonLink href="/learn/learning" size="sm">{t('learner.roadmap.start')}</ButtonLink>
          </div>
        )}
      </div>
    </li>
  );
}
