'use client';

import { useCallback } from 'react';
import { useParams } from 'next/navigation';
import { FiCheckCircle, FiAlertCircle, FiCircle, FiHelpCircle, FiArrowRight } from 'react-icons/fi';
import { useT } from '@/lib/i18n/i18n-context';
import { useResource } from '@/lib/hooks/use-resource';
import { finalizeDiagnostic, type PlacementResultView, type PlacementPointView, type PointOutcome } from '@/lib/api/placement-v2';
import { Button, ButtonLink, Card, MasteryProgress } from '@/components/ui';
import { ResourceView } from '@/components/ui/states';
import { OnboardingShell } from '@/components/onboarding/OnboardingShell';

/**
 * Placement V2 result — finalizes a COMPLETED diagnostic into the immutable PlacementDecision (idempotent) and
 * shows the honest profile: validated topics, gaps that stay in the path, per-domain bands where evidence exists
 * ("not assessed" is never rendered as 0%), and the recommended starting point into the V2 Learning Core.
 */
export default function PlacementV2ResultPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const res = useResource<PlacementResultView>(useCallback(() => finalizeDiagnostic(attemptId), [attemptId]), [attemptId]);

  return (
    <OnboardingShell step={2}>
      <ResourceView loading={res.loading} error={res.error} data={res.data} onRetry={res.reload}>
        {(r) => <Result result={r} />}
      </ResourceView>
    </OnboardingShell>
  );
}

function Result({ result }: { result: PlacementResultView }) {
  const t = useT();
  const validated = result.summary.validatedCount;
  const weak = result.summary.weakCount;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-text">{t('placementV2.result.title')}</h1>
        <p className="text-[15px] leading-relaxed text-muted">{t('placementV2.result.subtitleValidated')}</p>
        {result.claimedLevel && <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t('placementV2.result.claimedLevel', { level: result.claimedLevel })}</span>}
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2.5">
        <span className="inline-flex items-center gap-2 rounded-full bg-success-tint px-3.5 py-1.5 text-[13px] font-semibold text-success">
          <FiCheckCircle aria-hidden /> {t('placementV2.result.summaryValidated', { n: validated })}
        </span>
        {weak > 0 && (
          <span className="inline-flex items-center gap-2 rounded-full bg-surface-2 px-3.5 py-1.5 text-[13px] font-semibold text-text">
            <FiAlertCircle aria-hidden /> {t('placementV2.result.summaryWeak', { n: weak })}
          </span>
        )}
      </div>

      {/* Recommended start → into V2 teaching */}
      {result.recommendedStart && (
        <Card className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-wide text-primary">{t('placementV2.result.recommendedTitle')}</span>
            <span className="text-[17px] font-bold text-text">{result.recommendedStart.title}</span>
            <span className="text-[13.5px] text-muted">{t('placementV2.result.recommendedBody')}</span>
          </div>
          <ButtonLink href={`/teaching/${result.recommendedStart.roadmapPointId}`} variant="primary" size="lg" className="w-full justify-center" leftIcon={<FiArrowRight aria-hidden />}>
            {t('placementV2.result.startRecommended')}
          </ButtonLink>
        </Card>
      )}

      {/* Per-domain bands — only where objective evidence exists; others are honestly "not assessed" */}
      <section className="flex flex-col gap-4">
        <h2 className="text-[13px] font-bold text-text">{t('placementV2.result.domainsTitle')}</h2>
        <div className="flex flex-col gap-4">
          {result.domains.map((d) =>
            d.state === 'MEASURED' && d.bandBp !== null ? (
              <MasteryProgress key={d.code} value={d.bandBp / 100} label={d.name} />
            ) : (
              <div key={d.code} className="flex items-center justify-between rounded-control bg-surface-2 px-3.5 py-2.5">
                <span className="text-[14px] font-medium text-text">{d.name}</span>
                <span className="text-xs font-semibold text-muted">{t('placementV2.result.notAssessed')}</span>
              </div>
            ),
          )}
        </div>
        <p className="text-[12.5px] leading-relaxed text-muted">{t('placementV2.result.notAssessedNote')}</p>
      </section>

      {/* Per-topic outcome */}
      <section className="flex flex-col gap-4">
        <h2 className="text-[13px] font-bold text-text">{t('placementV2.result.pointsTitle')}</h2>
        <ul className="flex flex-col gap-2.5">
          {result.points.map((p) => (
            <li key={p.roadmapPointId}>
              <PointRow point={p} />
            </li>
          ))}
        </ul>
      </section>

      <div className="flex flex-col gap-3 pt-1">
        <ButtonLink href="/learn/present-simple" variant="primary" size="xl" className="w-full justify-center">
          {t('placementV2.result.viewRoadmap')}
        </ButtonLink>
      </div>
    </div>
  );
}

const OUTCOME: Record<PointOutcome, { icon: typeof FiCheckCircle; cls: string; key: string }> = {
  VALIDATED: { icon: FiCheckCircle, cls: 'text-success', key: 'placementV2.result.outcomeValidated' },
  WEAK: { icon: FiAlertCircle, cls: 'text-warning', key: 'placementV2.result.outcomeWeak' },
  AVAILABLE: { icon: FiCircle, cls: 'text-text', key: 'placementV2.result.outcomeAvailable' },
  UNASSESSED: { icon: FiHelpCircle, cls: 'text-muted', key: 'placementV2.result.outcomeUnassessed' },
};

function PointRow({ point }: { point: PlacementPointView }) {
  const t = useT();
  const o = OUTCOME[point.outcome];
  const Icon = o.icon;
  return (
    <div className="flex items-center justify-between gap-3 rounded-control border border-border bg-surface px-4 py-3">
      <span className="min-w-0 truncate text-[14.5px] font-medium text-text">{point.title}</span>
      <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold ${o.cls}`}>
        <Icon aria-hidden /> {t(o.key)}
      </span>
    </div>
  );
}
