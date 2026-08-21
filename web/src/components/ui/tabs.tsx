'use client';

import { useId, type ReactNode } from 'react';

export interface TabDef {
  key: string;
  label: string;
  icon?: ReactNode;
}

/** Accessible tab bar (roving via native buttons). Content is rendered by the caller keyed on `active`. */
export function Tabs({ tabs, active, onChange }: { tabs: TabDef[]; active: string; onChange: (key: string) => void }) {
  const base = useId();
  return (
    <div role="tablist" aria-label="Bo‘limlar" className="flex flex-wrap gap-1 border-b border-border">
      {tabs.map((t) => {
        const selected = t.key === active;
        return (
          <button
            key={t.key}
            id={`${base}-${t.key}`}
            role="tab"
            aria-selected={selected}
            type="button"
            onClick={() => onChange(t.key)}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              selected ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
