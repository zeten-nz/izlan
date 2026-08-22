'use client';

import { useT } from '@/lib/i18n/i18n-context';
import { DEMO_ACCOUNTS } from '@/lib/config/demo';

/** Dev demo-account helper. Fills the phone field ONLY via onPick — never the password, and never auto-logs-in. */
export function DemoAccounts({ onPick }: { onPick: (phone: string) => void }) {
  const t = useT();
  return (
    <div className="mt-4 space-y-2 border-t border-border pt-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{t('auth.demoTitle')}</p>
      <div className="grid gap-2">
        {DEMO_ACCOUNTS.map((a) => (
          <button
            key={a.phone}
            type="button"
            onClick={() => onPick(a.phone)}
            className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2"
          >
            <span className="font-medium text-text">{t(a.labelKey)}</span>
            <span className="text-xs text-muted">{a.display}</span>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted">{t('auth.demoHint')}</p>
    </div>
  );
}
