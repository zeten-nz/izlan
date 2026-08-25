'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { FiChevronRight } from 'react-icons/fi';
import { useT } from '@/lib/i18n/i18n-context';
import { Card } from '@/components/ui';
import { StatusBadge } from '@/components/ui/status-badge';

/**
 * Canonical Content Studio page header (Phase 07B). Formalizes the header pattern the detail screens hand-rolled — a
 * breadcrumb for depth comprehension, the entity title + real backend status, a meta line, an optional notice, and a
 * right-aligned actions slot. Chrome only: it renders whatever the caller passes and owns no domain logic, so the
 * mature CMS behavior/OCC is untouched. `status` maps to the shared StatusBadge (real backend statuses only).
 */
export type Crumb = { label: string; href?: string };

export function StudioHeader({
  breadcrumb,
  title,
  status,
  badges,
  meta,
  notice,
  actions,
}: {
  breadcrumb?: Crumb[];
  title: string;
  status?: string;
  badges?: ReactNode;
  meta?: ReactNode;
  notice?: ReactNode;
  actions?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="space-y-3">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav aria-label={t('hierarchy.breadcrumbLabel')} className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
          {breadcrumb.map((b, i) => (
            <span key={`${b.label}-${i}`} className="flex items-center gap-1.5">
              {i > 0 && <FiChevronRight aria-hidden size={14} className="text-border" />}
              {b.href ? (
                <Link href={b.href} className="rounded transition-colors hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                  {b.label}
                </Link>
              ) : (
                <span className="font-medium text-text">{b.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 truncate text-xl font-bold tracking-tight text-text sm:text-2xl">{title}</h1>
              {status && <StatusBadge status={status} />}
              {badges}
            </div>
            {meta && <div className="mt-1.5 text-sm text-muted">{meta}</div>}
            {notice}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </Card>
    </div>
  );
}
