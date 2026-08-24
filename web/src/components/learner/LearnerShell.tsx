'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { FiBarChart2, FiBookOpen, FiChevronDown, FiHome, FiLock, FiLogOut, FiMap, FiRepeat, FiUser } from 'react-icons/fi';
import { useAuth } from '@/lib/auth/auth-context';
import { useT } from '@/lib/i18n/i18n-context';
import { BrandMark, ThemeSwitcher } from '@/components/ui';
import { AuthLangPill } from '@/components/auth/AuthLangPill';

/**
 * The final Phase 03 learner shell — the frozen learner chrome that hosts Home, Roadmap, and (later) Learning,
 * Review and Results. It uses the frozen foundation only: the two-square BrandMark, the canonical 3-way ThemeSwitcher
 * (never the interim 2-way ThemeToggle) and the shared language pill. Primary nav on a desktop top bar and a mobile
 * bottom bar; secondary destinations (Fanlar / Profil / Chiqish) live in an accessible account disclosure.
 */

type NavItem = { key: 'home' | 'roadmap' | 'learn' | 'review' | 'results'; href?: string; icon: typeof FiHome; exact?: boolean; enabled: boolean };

// The five frozen primary items. Home + Roadmap are live this phase; the last three are future phases and are rendered
// as accessible, non-navigable disabled items (never fake links / placeholder routes).
const PRIMARY: NavItem[] = [
  { key: 'home', href: '/learn', icon: FiHome, exact: true, enabled: true },
  { key: 'roadmap', href: '/learn/roadmap', icon: FiMap, enabled: true },
  { key: 'learn', icon: FiBookOpen, enabled: false },
  { key: 'review', icon: FiRepeat, enabled: false },
  { key: 'results', icon: FiBarChart2, enabled: false },
];

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/** Accessible account disclosure — secondary destinations that are no longer primary nav. */
function AccountMenu() {
  const t = useT();
  const router = useRouter();
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  async function onLogout() {
    setOpen(false);
    await logout();
    router.replace('/login');
  }

  const itemClass = 'flex w-full items-center gap-2 rounded-control px-3 py-2 text-sm text-text transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none';

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <FiUser aria-hidden />
        <span className="sr-only">{t('learner.nav.account')}</span>
        <FiChevronDown aria-hidden size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-48 rounded-control border border-border bg-surface p-1 shadow-lg">
          <Link href="/learn/subjects" onClick={() => setOpen(false)} className={itemClass}>
            <FiBookOpen aria-hidden className="text-muted" /> {t('learner.nav.subjects')}
          </Link>
          <Link href="/learn/profile" onClick={() => setOpen(false)} className={itemClass}>
            <FiUser aria-hidden className="text-muted" /> {t('learner.nav.profile')}
          </Link>
          <button type="button" onClick={onLogout} className={`${itemClass} text-left`}>
            <FiLogOut aria-hidden className="text-muted" /> {t('learner.nav.logout')}
          </button>
        </div>
      )}
    </div>
  );
}

/** Desktop primary nav (top bar). Disabled future items carry a lock icon + sr-only label — state is never color-only. */
function DesktopNav({ pathname }: { pathname: string }) {
  const t = useT();
  return (
    <nav className="hidden items-center gap-1 md:flex" aria-label={t('learner.nav.primary')}>
      {PRIMARY.map((n) => {
        const label = t(`learner.nav.${n.key}`);
        if (!n.enabled) {
          return (
            <span
              key={n.key}
              aria-disabled="true"
              title={t('learner.nav.soon')}
              className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-control px-3 py-1.5 text-sm font-medium text-muted/60"
            >
              {label}
              <FiLock aria-hidden size={13} />
              <span className="sr-only"> — {t('learner.nav.soon')}</span>
            </span>
          );
        }
        const active = isActive(pathname, n.href!, n.exact);
        return (
          <Link
            key={n.key}
            href={n.href!}
            aria-current={active ? 'page' : undefined}
            className={`rounded-control px-3 py-1.5 text-sm font-medium transition-colors ${active ? 'bg-surface-2 text-text' : 'text-muted hover:bg-surface-2 hover:text-text'}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Mobile primary nav (fixed bottom bar). Five items; disabled items are non-navigable with a lock overlay + sr-only text. */
function MobileNav({ pathname }: { pathname: string }) {
  const t = useT();
  return (
    <nav aria-label={t('learner.nav.primary')} className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur md:hidden">
      <div className="mx-auto grid max-w-3xl grid-cols-5">
        {PRIMARY.map((n) => {
          const label = t(`learner.nav.${n.key}`);
          const Icon = n.icon;
          if (!n.enabled) {
            return (
              <span key={n.key} aria-disabled="true" className="relative flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-muted/50">
                <span className="relative">
                  <Icon aria-hidden className="text-lg" />
                  <FiLock aria-hidden size={9} className="absolute -right-1.5 -top-1" />
                </span>
                {label}
                <span className="sr-only"> — {t('learner.nav.soon')}</span>
              </span>
            );
          }
          const active = isActive(pathname, n.href!, n.exact);
          return (
            <Link key={n.key} href={n.href!} aria-current={active ? 'page' : undefined} className={`flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${active ? 'text-primary' : 'text-muted'}`}>
              <Icon aria-hidden className="text-lg" />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function LearnerShell({ children }: { children: React.ReactNode }) {
  const t = useT();
  const pathname = usePathname() ?? '/learn';

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <header className="sticky top-0 z-30 flex h-[72px] shrink-0 items-center gap-4 border-b border-border bg-surface/90 px-4 backdrop-blur sm:px-8">
        <Link href="/learn" className="flex items-center gap-2.5" aria-label={t('landing.brand')}>
          <BrandMark />
          <span className="text-lg font-extrabold tracking-tight">{t('landing.brand')}</span>
        </Link>
        <div className="ml-2 flex-1">
          <DesktopNav pathname={pathname} />
        </div>
        <div className="flex items-center gap-2">
          <ThemeSwitcher />
          <AuthLangPill />
          <AccountMenu />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-6 sm:px-6 md:pb-12">{children}</main>

      <MobileNav pathname={pathname} />
    </div>
  );
}
