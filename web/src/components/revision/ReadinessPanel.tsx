'use client';

import { useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FiCheckCircle, FiXCircle, FiAlertTriangle, FiRefreshCw } from 'react-icons/fi';
import { getReadiness } from '@/lib/api/content';
import type { ReadinessItem } from '@/lib/api/types';
import { useResource } from '@/lib/hooks/use-resource';
import { useRevisionEditor } from '@/lib/cms/revision-editor-context';
import { useT } from '@/lib/i18n/i18n-context';
import { Button } from '@/components/ui';
import { ResourceView } from '@/components/ui/states';
import { listItem } from '@/lib/motion/motion';

function ReadyFlag({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${ok ? 'border-success/30 bg-success/10 text-success' : 'border-border bg-surface-2 text-muted'}`}>
      {ok ? <FiCheckCircle aria-hidden /> : <FiXCircle aria-hidden />}
      <span className="font-medium">{label}</span>
    </div>
  );
}

export function ReadinessPanel() {
  const { revision } = useRevisionEditor();
  const t = useT();
  const res = useResource(useCallback(() => getReadiness(revision.id), [revision.id]), [revision.id, revision.updatedAt]);

  const label = (item: ReadinessItem) => {
    const key = `readiness.codes.${item.code}`;
    const msg = t(key);
    return msg === key ? t('readiness.unknown', { code: item.code }) : msg;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">{t('readiness.title')}</h3>
        <Button size="sm" variant="ghost" leftIcon={<FiRefreshCw aria-hidden />} onClick={res.reload}>
          {t('readiness.refresh')}
        </Button>
      </div>
      <ResourceView loading={res.loading} error={res.error} data={res.data} onRetry={res.reload}>
        {(r) => (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <ReadyFlag ok={r.reviewReady} label={t('readiness.reviewReady')} />
              <ReadyFlag ok={r.publishReady} label={t('readiness.publishReady')} />
            </div>
            {r.blockers.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-danger">
                  {t('readiness.blockers')} · {t('readiness.problemsCount', { n: r.blockers.length })}
                </p>
                <ul className="space-y-1.5">
                  <AnimatePresence initial={false}>
                    {r.blockers.map((it, i) => (
                      <motion.li key={`${it.code}-${i}`} variants={listItem} initial="initial" animate="animate" exit="exit" className="flex items-start gap-2 text-sm">
                        <FiXCircle className="mt-0.5 shrink-0 text-danger" aria-hidden />
                        <span className="text-text">{label(it)}</span>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              </div>
            )}
            {r.warnings.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-warning">
                  {t('readiness.warnings')} · {t('readiness.warningsCount', { n: r.warnings.length })}
                </p>
                <ul className="space-y-1.5">
                  {r.warnings.map((it, i) => (
                    <li key={`${it.code}-${i}`} className="flex items-start gap-2 text-sm">
                      <FiAlertTriangle className="mt-0.5 shrink-0 text-warning" aria-hidden />
                      <span className="text-text">{label(it)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {r.blockers.length === 0 && r.warnings.length === 0 && <p className="text-sm text-success">{t('readiness.allClear')}</p>}
          </div>
        )}
      </ResourceView>
    </div>
  );
}
