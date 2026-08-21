'use client';

import { useCallback } from 'react';
import { FiCheckCircle, FiXCircle, FiAlertTriangle, FiRefreshCw } from 'react-icons/fi';
import { getReadiness } from '@/lib/api/content';
import type { ReadinessItem } from '@/lib/api/types';
import { useResource } from '@/lib/hooks/use-resource';
import { useRevisionEditor } from '@/lib/cms/revision-editor-context';
import { readinessLabel } from '@/lib/readiness/labels';
import { Button } from '@/components/ui';
import { ResourceView } from '@/components/ui/states';

function ReadyFlag({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${ok ? 'border-success/30 bg-success/10 text-success' : 'border-border bg-surface-2 text-muted'}`}>
      {ok ? <FiCheckCircle aria-hidden /> : <FiXCircle aria-hidden />}
      {label}: <strong>{ok ? 'ha' : 'yo‘q'}</strong>
    </div>
  );
}

function ItemList({ items, tone }: { items: ReadinessItem[]; tone: 'danger' | 'warning' }) {
  const Icon = tone === 'danger' ? FiXCircle : FiAlertTriangle;
  const color = tone === 'danger' ? 'text-danger' : 'text-warning';
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={`${it.code}-${i}`} className="flex items-start gap-2 text-sm">
          <Icon className={`mt-0.5 shrink-0 ${color}`} aria-hidden />
          <span className="text-text">{readinessLabel(it.code)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Readiness display (auto-refreshes on revision token change). Publish gating is enforced in WorkflowActions. */
export function ReadinessPanel() {
  const { revision } = useRevisionEditor();
  const res = useResource(useCallback(() => getReadiness(revision.id), [revision.id]), [revision.id, revision.updatedAt]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">Tayyorlik</h3>
        <Button size="sm" variant="ghost" leftIcon={<FiRefreshCw aria-hidden />} onClick={res.reload}>
          Yangilash
        </Button>
      </div>
      <ResourceView loading={res.loading} error={res.error} data={res.data} onRetry={res.reload}>
        {(r) => (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <ReadyFlag ok={r.reviewReady} label="Ko‘rikka tayyor" />
              <ReadyFlag ok={r.publishReady} label="Nashrga tayyor" />
            </div>
            {r.blockers.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-danger">Bloklovchilar</p>
                <ItemList items={r.blockers} tone="danger" />
              </div>
            )}
            {r.warnings.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-warning">Ogohlantirishlar</p>
                <ItemList items={r.warnings} tone="warning" />
              </div>
            )}
            {r.blockers.length === 0 && r.warnings.length === 0 && <p className="text-sm text-success">Hech qanday muammo yo‘q.</p>}
          </div>
        )}
      </ResourceView>
    </div>
  );
}
