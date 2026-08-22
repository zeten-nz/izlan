'use client';

import { useId, type ReactNode } from 'react';
import { motion } from 'framer-motion';

export interface TabDef {
  key: string;
  label: string;
  icon?: ReactNode;
}

/** Accessible tab bar with a shared-layout active indicator that slides between tabs. */
export function Tabs({ tabs, active, onChange }: { tabs: TabDef[]; active: string; onChange: (key: string) => void }) {
  const base = useId();
  return (
    <div role="tablist" className="flex flex-wrap gap-1 border-b border-border">
      {tabs.map((tab) => {
        const selected = tab.key === active;
        return (
          <button
            key={tab.key}
            id={`${base}-${tab.key}`}
            role="tab"
            aria-selected={selected}
            type="button"
            onClick={() => onChange(tab.key)}
            className={`relative -mb-px inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
              selected ? 'text-primary' : 'text-muted hover:text-text'
            }`}
          >
            {tab.icon}
            {tab.label}
            {selected && <motion.span layoutId={`${base}-underline`} className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-primary" transition={{ type: 'spring', stiffness: 500, damping: 34 }} />}
          </button>
        );
      })}
    </div>
  );
}
