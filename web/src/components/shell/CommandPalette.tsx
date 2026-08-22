'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { FiBookOpen, FiCornerDownLeft, FiFolder, FiMoon, FiSearch, FiSun } from 'react-icons/fi';
import { listSubjects } from '@/lib/api/content';
import { useResource } from '@/lib/hooks/use-resource';
import { useTheme } from '@/lib/theme/theme-context';
import { useT } from '@/lib/i18n/i18n-context';
import { useFocusTrap } from '@/lib/hooks/use-focus-trap';
import { dialogPanel, overlayFade } from '@/lib/motion/motion';

interface Command {
  id: string;
  label: string;
  section: string;
  icon: React.ReactNode;
  run: () => void;
}

/**
 * ⌘K / Ctrl+K command palette. Exposes ONLY commands possible with current client data (navigate, switch among
 * assigned subjects, toggle theme). No new backend search — a pure UX accelerator.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { toggle, resolved } = useTheme();
  const t = useT();
  const subjectsRes = useResource(useCallback(() => listSubjects(), []), [open]);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus containment + restoration: initial focus to the search input, Tab trapped, focus restored to the opener.
  useFocusTrap(panelRef, open, inputRef);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => {
      onClose();
      router.push(path);
    };
    const list: Command[] = [
      { id: 'subjects', label: t('palette.goSubjects'), section: t('palette.sectionNav'), icon: <FiFolder aria-hidden />, run: go('/staff/content') },
      ...(subjectsRes.data ?? []).map((s) => ({
        id: `subject-${s.id}`,
        label: t('palette.switchSubject', { title: s.title }),
        section: t('palette.sectionNav'),
        icon: <FiBookOpen aria-hidden />,
        run: go(`/staff/content/subjects/${s.id}`),
      })),
      {
        id: 'theme',
        label: t('palette.toggleTheme'),
        section: t('palette.sectionActions'),
        icon: resolved === 'dark' ? <FiSun aria-hidden /> : <FiMoon aria-hidden />,
        run: () => {
          toggle();
          onClose();
        },
      },
    ];
    const query = q.trim().toLowerCase();
    return query ? list.filter((c) => c.label.toLowerCase().includes(query)) : list;
  }, [subjectsRes.data, q, t, router, onClose, toggle, resolved]);

  useEffect(() => {
    if (active >= commands.length) setActive(0);
  }, [commands.length, active]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % Math.max(commands.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a - 1 + commands.length) % Math.max(commands.length, 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commands[active]?.run();
    } else if (e.key === 'Escape') {
      onClose();
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-start justify-center p-4 pt-[12vh]">
          <motion.div variants={overlayFade} initial="initial" animate="animate" exit="exit" className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
          <motion.div
            ref={panelRef}
            variants={dialogPanel}
            initial="initial"
            animate="animate"
            exit="exit"
            role="dialog"
            aria-modal="true"
            aria-label={t('palette.title')}
            className="izl-elevate relative z-10 w-full max-w-xl overflow-hidden rounded-card border border-border bg-surface"
          >
            <div className="flex items-center gap-2 border-b border-border px-4">
              <FiSearch className="text-muted" aria-hidden />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={t('palette.placeholder')}
                aria-label={t('palette.placeholder')}
                className="h-12 flex-1 bg-transparent text-sm text-text placeholder:text-muted focus:outline-none"
              />
            </div>
            <ul className="izl-scroll max-h-80 overflow-y-auto p-1.5">
              {commands.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">{t('palette.empty')}</li>}
              {commands.map((c, i) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={c.run}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${i === active ? 'bg-primary/10 text-primary' : 'text-text hover:bg-surface-2'}`}
                  >
                    <span className="text-muted">{c.icon}</span>
                    <span className="flex-1 truncate">{c.label}</span>
                    {i === active && <FiCornerDownLeft className="text-muted" aria-hidden />}
                  </button>
                </li>
              ))}
            </ul>
            <div className="border-t border-border px-4 py-2 text-xs text-muted">{t('palette.hint')}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
