'use client';

import { FiAlertTriangle } from 'react-icons/fi';
import { Button } from './primitives';
import { useT } from '@/lib/i18n/i18n-context';

/**
 * OCC edit-conflict banner (§13). Shown when a mutation returns CONTENT_EDIT_CONFLICT. We NEVER auto-retry a
 * state-changing mutation — the user explicitly chooses to reload the latest server state or cancel their local edit.
 */
export function ConflictBanner({ onReload, onCancel }: { onReload: () => void; onCancel: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 text-text">
        <FiAlertTriangle className="mt-0.5 shrink-0 text-warning" aria-hidden />
        <span>{t('conflict.message')}</span>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={onCancel}>
          {t('conflict.discard')}
        </Button>
        <Button size="sm" onClick={onReload}>
          {t('conflict.reload')}
        </Button>
      </div>
    </div>
  );
}
