'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FiArrowRight, FiFlag, FiZap } from 'react-icons/fi';
import { useT } from '@/lib/i18n/i18n-context';
import { useResource } from '@/lib/hooks/use-resource';
import { describeError } from '@/lib/ui/error-text';
import { fetchLearningIntents } from '@/lib/api/onboarding';
import { startFromZero } from '@/lib/api/placement-v2';
import type { LearningIntent } from '@/lib/api/types';
import { Button, Spinner } from '@/components/ui';
import { OnboardingShell } from '@/components/onboarding/OnboardingShell';

/**
 * Placement V2 entry — the learner chooses their honest starting point: NEW ("start from zero", no diagnostic,
 * FRESH_START decision + full available A1 roadmap) or CLAIMS_LEVEL (take the existing diagnostic, gated with
 * ?v2=1 so completion routes to the V2 result). The server owns the decision; this screen only routes.
 */
export default function PlacementV2Page() {
  const t = useT();
  const res = useResource<LearningIntent[]>(useCallback(() => fetchLearningIntents(), []), []);
  const intent = res.data?.find((i) => i.track) ?? res.data?.[0] ?? null;

  return (
    <OnboardingShell step={2}>
      {res.loading && (
        <div className="grid min-h-[40vh] place-items-center">
          <Spinner label={t('placementV2.choose.loading')} />
        </div>
      )}
      {!res.loading && !intent && (
        <div className="mx-auto flex max-w-[460px] flex-col items-center gap-4 rounded-panel border border-border bg-surface px-6 py-12 text-center">
          <h1 className="text-[22px] font-extrabold tracking-tight text-text">{t('placementV2.choose.noIntentTitle')}</h1>
          <p className="text-sm leading-relaxed text-muted">{t('placementV2.choose.noIntentBody')}</p>
        </div>
      )}
      {intent && <ChoosePath intent={intent} />}
    </OnboardingShell>
  );
}

function ChoosePath({ intent }: { intent: LearningIntent }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'zero' | 'claims'>(null);
  const [error, setError] = useState<string | null>(null);

  async function fromZero() {
    if (busy) return;
    setBusy('zero');
    setError(null);
    try {
      await startFromZero(intent.subject.id, crypto.randomUUID()); // immutable FRESH_START — full available roadmap
      router.replace('/learn/today'); // placement done → continue to Today (the hub)
    } catch (e) {
      setError(describeError(e, t));
      setBusy(null);
    }
  }

  function claimsLevel() {
    if (busy) return;
    setBusy('claims');
    router.push(`/placement?learningIntentId=${intent.id}&v2=1`);
  }

  return (
    <div className="flex flex-col gap-7">
      <div className="inline-flex w-fit items-center gap-2.5 rounded-full border border-border bg-surface-2 px-3.5 py-2 text-[13px]">
        <span className="font-bold">{intent.subject.title}</span>
        {intent.track && (
          <>
            <span aria-hidden className="h-3 w-px bg-border" />
            <span className="text-muted">{intent.track.title}</span>
          </>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-text">{t('placementV2.choose.title')}</h1>
        <p className="text-[15px] leading-relaxed text-muted">{t('placementV2.choose.subtitle')}</p>
      </div>

      {error && (
        <p role="alert" className="rounded-control bg-danger-tint px-3.5 py-2.5 text-sm font-medium text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-4">
        <PathCard
          icon={<FiFlag aria-hidden size={22} />}
          title={t('placementV2.choose.fromZeroTitle')}
          body={t('placementV2.choose.fromZeroBody')}
          cta={t('placementV2.choose.fromZeroCta')}
          onClick={fromZero}
          loading={busy === 'zero'}
          disabled={busy !== null}
          variant="primary"
        />
        <PathCard
          icon={<FiZap aria-hidden size={22} />}
          title={t('placementV2.choose.claimsTitle')}
          body={t('placementV2.choose.claimsBody')}
          note={t('placementV2.choose.levelNote')}
          cta={t('placementV2.choose.claimsCta')}
          onClick={claimsLevel}
          loading={busy === 'claims'}
          disabled={busy !== null}
          variant="secondary"
        />
      </div>
    </div>
  );
}

function PathCard({
  icon,
  title,
  body,
  note,
  cta,
  onClick,
  loading,
  disabled,
  variant,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  note?: string;
  cta: string;
  onClick: () => void;
  loading: boolean;
  disabled: boolean;
  variant: 'primary' | 'secondary';
}) {
  return (
    <div className="flex flex-col gap-4 rounded-panel border border-border bg-surface p-5">
      <div className="flex items-start gap-3.5">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-panel ${variant === 'primary' ? 'bg-primary-tint text-primary' : 'bg-surface-2 text-text'}`}>{icon}</span>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-[17px] font-bold leading-snug text-text">{title}</h2>
          <p className="text-[14px] leading-relaxed text-muted">{body}</p>
          {note && <span className="mt-0.5 text-xs font-semibold text-muted">{note}</span>}
        </div>
      </div>
      <Button type="button" size="lg" variant={variant} loading={loading} disabled={disabled} className="w-full" onClick={onClick} leftIcon={<FiArrowRight aria-hidden />}>
        {cta}
      </Button>
    </div>
  );
}
