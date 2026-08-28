'use client';

import { useCallback } from 'react';
import { FiCheckCircle, FiCircle, FiLock, FiPlayCircle } from 'react-icons/fi';
import { useT } from '@/lib/i18n/i18n-context';
import { useResource } from '@/lib/hooks/use-resource';
import { fetchLearningIntents } from '@/lib/api/onboarding';
import { fetchV2Roadmap, type V2Roadmap, type V2RoadmapPoint } from '@/lib/api/v2-learning';
import { ButtonLink, Card } from '@/components/ui';
import { ResourceView } from '@/components/ui/states';

interface V2RoadmapData {
  subjectTitle: string | null;
  roadmap: V2Roadmap | null;
}

async function loadV2Roadmap(): Promise<V2RoadmapData> {
  const intents = await fetchLearningIntents();
  const selected = intents.find((i) => i.track) ?? intents[0] ?? null;
  if (!selected) return { subjectTitle: null, roadmap: null };
  const roadmap = await fetchV2Roadmap(selected.subject.id);
  return { subjectTitle: selected.subject.title, roadmap };
}

export default function PresentSimpleRoadmapPage() {
  const t = useT();
  const res = useResource(useCallback(() => loadV2Roadmap(), []), []);

  return (
    <ResourceView loading={res.loading} error={res.error} data={res.data} onRetry={res.reload}>
      {(d) => (
        <div className="space-y-6">
          <header>
            <h1 className="text-2xl font-bold tracking-tight">{t('learner.v2.title')}</h1>
            <p className="mt-0.5 text-muted">{d.subjectTitle ?? t('learner.v2.subtitle')}</p>
          </header>

          {!d.roadmap || d.roadmap.points.length === 0 ? (
            <Card className="p-6">
              <p className="text-muted">{t('learner.v2.empty')}</p>
            </Card>
          ) : (
            <ol className="space-y-4">
              {d.roadmap.points.map((p) => (
                <li key={p.roadmapPointId}>
                  <PointCard point={p} />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </ResourceView>
  );
}

function PointCard({ point }: { point: V2RoadmapPoint }) {
  const t = useT();
  const canDo = point.learningOutcome?.canDo ?? [];
  const locked = point.availability === 'LOCKED' || point.availability === 'CONTENT_UNAVAILABLE';
  const state = point.learned
    ? { icon: FiCheckCircle, cls: 'text-success', label: t('learner.v2.stateLearned') }
    : point.availability === 'IN_PROGRESS'
      ? { icon: FiPlayCircle, cls: 'text-primary', label: t('learner.v2.stateInProgress') }
      : locked
        ? { icon: FiLock, cls: 'text-muted', label: t('learner.v2.stateLocked') }
        : { icon: FiCircle, cls: 'text-text', label: t('learner.v2.stateAvailable') };
  const Icon = state.icon;
  const cta = point.learned ? t('learner.v2.review') : point.availability === 'IN_PROGRESS' ? t('learner.v2.continue') : t('learner.v2.start');

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Icon aria-hidden className={`text-lg ${state.cls}`} />
            <span className={`text-xs font-semibold ${state.cls}`}>{state.label}</span>
            {point.estimatedEffortMin != null && (
              <span className="text-xs text-muted">· {t('learner.v2.minutes', { min: point.estimatedEffortMin })}</span>
            )}
          </div>
          <h2 className="mt-2 text-lg font-semibold">{point.title}</h2>
          {canDo.length > 0 && (
            <ul className="mt-2 space-y-1">
              {canDo.map((c, i) => (
                <li key={i} className="flex gap-2 text-sm text-muted">
                  <FiCheckCircle aria-hidden className="mt-0.5 shrink-0 text-success/70" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {!locked && (
          <ButtonLink href={`/teaching/${point.roadmapPointId}`} variant={point.learned ? 'secondary' : 'primary'} className="shrink-0">
            {cta}
          </ButtonLink>
        )}
      </div>
    </Card>
  );
}
