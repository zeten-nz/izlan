'use client';

import { useT } from '@/lib/i18n/i18n-context';

/**
 * Maturity pill for the public landing. Conveys product status with TEXT + colour (never colour alone):
 *  - available → Mavjud (implemented today)
 *  - soon      → Tez orada (accepted/planned; runtime not live yet)
 *  - planned   → Rejada (concept stage)
 * Rendered as meaningful content (NOT aria-hidden) so assistive tech announces the status.
 */
export type Maturity = 'available' | 'soon' | 'planned';

const STYLE: Record<Maturity, string> = {
  available: 'text-success bg-success-tint',
  soon: 'text-primary bg-primary-tint',
  planned: 'text-danger bg-danger-tint',
};
const KEY: Record<Maturity, string> = {
  available: 'landing.maturityAvailable',
  soon: 'landing.maturitySoon',
  planned: 'landing.maturityPlanned',
};

export function MaturityBadge({ kind, className = '' }: { kind: Maturity; className?: string }) {
  const t = useT();
  return (
    <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${STYLE[kind]} ${className}`}>
      {t(KEY[kind])}
    </span>
  );
}
