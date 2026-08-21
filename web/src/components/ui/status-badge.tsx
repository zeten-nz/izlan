'use client';

import { FiEdit3, FiEye, FiCheckCircle, FiArchive, FiCircle } from 'react-icons/fi';

type Known = 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED' | 'ACTIVE';

// Status is conveyed by TEXT + ICON + color (never color alone) for accessibility.
const MAP: Record<Known, { label: string; cls: string; Icon: typeof FiCircle }> = {
  DRAFT: { label: 'Qoralama', cls: 'bg-surface-2 text-muted border-border', Icon: FiEdit3 },
  REVIEW: { label: 'Ko‘rikda', cls: 'bg-warning/10 text-warning border-warning/30', Icon: FiEye },
  PUBLISHED: { label: 'Nashr etilgan', cls: 'bg-success/10 text-success border-success/30', Icon: FiCheckCircle },
  ARCHIVED: { label: 'Arxivlangan', cls: 'bg-danger/10 text-danger border-danger/30', Icon: FiArchive },
  ACTIVE: { label: 'Faol', cls: 'bg-success/10 text-success border-success/30', Icon: FiCheckCircle },
};

export function StatusBadge({ status }: { status: string }) {
  const entry = MAP[status as Known] ?? { label: status, cls: 'bg-surface-2 text-muted border-border', Icon: FiCircle };
  const { label, cls, Icon } = entry;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      <Icon aria-hidden className="text-[0.9em]" />
      {label}
    </span>
  );
}

export function Badge({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'primary' | 'success' | 'danger' | 'warning' }) {
  const tones: Record<string, string> = {
    muted: 'bg-surface-2 text-muted border-border',
    primary: 'bg-primary/10 text-primary border-primary/30',
    success: 'bg-success/10 text-success border-success/30',
    danger: 'bg-danger/10 text-danger border-danger/30',
    warning: 'bg-warning/10 text-warning border-warning/30',
  };
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
