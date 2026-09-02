'use client';

import { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/i18n-context';
import { useResource } from '@/lib/hooks/use-resource';
import { fetchLearnerHome, type LearnerStage } from '@/lib/api/learner';
import { Button, Card, Spinner } from '@/components/ui';
import { describeError } from '@/lib/ui/error-text';

/**
 * The learner-area entry (first-run router). It asks the server ONE authoritative question — where should this
 * learner land right now? — and redirects: not onboarded → /onboarding; onboarded but not placed → /placement/v2;
 * placed → /learn/today (the canonical home). No routing is inferred from localStorage/UI state, so refresh and
 * re-login behave identically. This page renders nothing durable — it only decides and forwards.
 */
const STAGE_PATH: Record<LearnerStage, string> = {
  ONBOARDING: '/onboarding',
  PLACEMENT: '/placement/v2',
  TODAY: '/learn/today',
};

export default function LearnEntryPage() {
  const t = useT();
  const router = useRouter();
  const res = useResource(useCallback(() => fetchLearnerHome(), []), []);

  useEffect(() => {
    if (res.data) router.replace(STAGE_PATH[res.data.stage]);
  }, [res.data, router]);

  if (res.error) {
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <Card className="max-w-md p-6 text-center">
          <p className="text-muted">{describeError(res.error, t)}</p>
          <div className="mt-4"><Button onClick={res.reload}>{t('common.retry')}</Button></div>
        </Card>
      </div>
    );
  }
  return (
    <div className="grid min-h-[50vh] place-items-center" role="status" aria-live="polite">
      <Spinner label={t('learner.common.loading')} />
    </div>
  );
}
