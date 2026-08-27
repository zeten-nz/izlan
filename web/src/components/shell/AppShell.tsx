'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  FiActivity, FiChevronsLeft, FiChevronsRight, FiClipboard, FiCommand, FiCreditCard, FiFolder,
  FiGrid, FiLock, FiLogOut, FiMenu, FiShield, FiUsers, FiX,
} from 'react-icons/fi';
import { useAuth } from '@/lib/auth/auth-context';
import { useCms } from '@/lib/cms/cms-context';
import { useT } from '@/lib/i18n/i18n-context';
import { BrandMark, Button, IconButton, Spinner, ThemeSwitcher } from '@/components/ui';
import { Badge } from '@/components/ui/status-badge';
import { SubjectSwitcher } from './SubjectSwitcher';
import { LocaleSwitcher } from './LocaleSwitcher';
import { CommandPalette } from './CommandPalette';
import { overlayFade } from '@/lib/motion/motion';

const SIDEBAR_KEY = 'izl-sidebar'; // UI preference only (collapsed/expanded)
const DRAWER_ID = 'staff-mobile-drawer';

// Final Admin/Staff information architecture (07). The ONLY live destination is Content (the mature CMS); every other
// area is an accepted-but-not-yet-built admin surface with NO backend contract, so it is rendered as a non-navigable
// "Tez orada" item — never a fake page, never fabricated data. (See Phase 07 audit.)
type NavItem = { key: string; icon: typeof FiFolder; href?: string; soon?: boolean };
type NavSection = { header: string; items: NavItem[] };

const SECTIONS: NavSection[] = [
  { header: 'sectionMain', items: [{ key: 'dashboard', icon: FiGrid, soon: true }] },
  { header: 'content', items: [
    { key: 'subjects', icon: FiFolder, href: '/staff/content' },
    { key: 'assessment', icon: FiClipboard, href: '/staff/content/assessments' },
  ] },
  { header: 'sectionAdmin', items: [
    { key: 'users', icon: FiUsers, soon: true },
    { key: 'staffAccess', icon: FiShield, soon: true },
  ] },
  { header: 'sectionOps', items: [
    { key: 'payments', icon: FiCreditCard, soon: true },
    { key: 'system', icon: FiActivity, soon: true },
  ] },
];

// All live nav destinations — used so the MOST SPECIFIC matching href wins (e.g. /staff/content/assessments highlights
// only the assessment item, not the subjects item whose /staff/content is a prefix of it).
const NAV_HREFS = SECTIONS.flatMap((s) => s.items).flatMap((i) => (i.href ? [i.href] : []));
const matchesHref = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);
const isNavActive = (pathname: string, href: string) =>
  matchesHref(pathname, href) && !NAV_HREFS.some((other) => other !== href && other.length > href.length && matchesHref(pathname, other));

function NavRow({ item, collapsed, pathname, onNavigate }: { item: NavItem; collapsed: boolean; pathname: string; onNavigate?: () => void }) {
  const t = useT();
  const Icon = item.icon;
  const label = t(`nav.${item.key}`);

  if (item.soon) {
    // Non-interactive (not a link/button → not focusable, not keyboard-clickable). State is conveyed with TEXT, not colour.
    return (
      <span
        aria-disabled="true"
        title={`${label} — ${t('nav.soon')}`}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted/50 ${collapsed ? 'justify-center px-0' : ''}`}
      >
        <span className="relative shrink-0">
          <Icon aria-hidden />
          {collapsed && <FiLock aria-hidden size={9} className="absolute -right-1.5 -top-1" />}
        </span>
        {!collapsed ? (
          <>
            <span className="flex-1 truncate">{label}</span>
            <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-muted">{t('nav.soon')}</span>
          </>
        ) : (
          <span className="sr-only">{label} — {t('nav.soon')}</span>
        )}
      </span>
    );
  }

  const active = item.href ? isNavActive(pathname, item.href) : false;
  return (
    <Link
      href={item.href!}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      title={label}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active ? 'bg-primary-tint text-primary' : 'text-text hover:bg-surface-2'} ${collapsed ? 'justify-center px-0' : ''}`}
    >
      <Icon aria-hidden className="shrink-0" />
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
    </Link>
  );
}

function CapabilityChips() {
  const { capabilities } = useCms();
  const t = useT();
  return (
    <div className="flex flex-wrap gap-1.5">
      {capabilities.author && <Badge tone="primary">{t('nav.capAuthor')}</Badge>}
      {capabilities.publish && <Badge tone="success">{t('nav.capPublish')}</Badge>}
      {capabilities.subjectManage && <Badge tone="warning">{t('nav.capManage')}</Badge>}
    </div>
  );
}

function SidebarContent({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const t = useT();
  const pathname = usePathname() ?? '';
  return (
    <div className="flex h-full flex-col gap-5 p-3">
      <Link href="/staff/content" onClick={onNavigate} aria-label={t('common.appName')} title={t('common.appName')} className="flex items-center gap-2.5 px-1 py-1">
        <BrandMark />
        {!collapsed && <span className="truncate text-lg font-extrabold tracking-tight text-text">{t('common.appName')}</span>}
      </Link>

      {!collapsed && <SubjectSwitcher />}

      <nav aria-label={t('nav.primary')} className="flex flex-col gap-4">
        {SECTIONS.map((sec) => (
          <div key={sec.header} className="flex flex-col gap-1">
            {!collapsed && <p className="px-3 text-[11px] font-semibold uppercase tracking-wide text-muted/70">{t(`nav.${sec.header}`)}</p>}
            {sec.items.map((it) => <NavRow key={it.key} item={it} collapsed={collapsed} pathname={pathname} onNavigate={onNavigate} />)}
          </div>
        ))}
      </nav>

      {!collapsed && (
        <div className="mt-auto space-y-2 border-t border-border pt-4">
          <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted">{t('nav.permissions')}</p>
          <CapabilityChips />
        </div>
      )}
    </div>
  );
}

function AccessUnavailable() {
  const { logout } = useAuth();
  const t = useT();
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="izl-elevate max-w-md space-y-4 rounded-card border border-border bg-surface p-8 text-center">
        <FiShield className="mx-auto text-3xl text-muted" aria-hidden />
        <h1 className="text-lg font-semibold text-text">{t('cms.accessTitle')}</h1>
        <p className="text-sm text-muted">{t('cms.accessBody')}</p>
        <Button variant="secondary" leftIcon={<FiLogOut aria-hidden />} onClick={() => void logout()}>
          {t('nav.logout')}
        </Button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { status, reload } = useCms();
  const { logout } = useAuth();
  const t = useT();
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_KEY) === '1');
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Global ⌘K / Ctrl+K opens the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (status === 'forbidden') return <AccessUnavailable />;
  if (status === 'error')
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <div className="space-y-3 text-center">
          <p className="text-sm text-muted">{t('cms.sessionError')}</p>
          <Button variant="secondary" onClick={reload}>
            {t('common.retry')}
          </Button>
        </div>
      </div>
    );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar (animated collapse) */}
      <motion.aside animate={{ width: collapsed ? 72 : 264 }} transition={{ type: 'spring', stiffness: 380, damping: 34 }} className="relative hidden shrink-0 border-r border-border bg-surface lg:block">
        <SidebarContent collapsed={collapsed} />
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
          title={collapsed ? t('nav.expand') : t('nav.collapse')}
          className="absolute -right-3 top-16 grid h-6 w-6 place-items-center rounded-full border border-border bg-surface text-muted transition-colors hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {collapsed ? <FiChevronsRight aria-hidden /> : <FiChevronsLeft aria-hidden />}
        </button>
      </motion.aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {drawer && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <motion.div variants={overlayFade} initial="initial" animate="animate" exit="exit" className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} aria-hidden />
            <motion.div
              id={DRAWER_ID}
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
              className="absolute left-0 top-0 h-full w-72 border-r border-border bg-surface"
            >
              <div className="flex justify-end p-2">
                <IconButton label={t('nav.closeMenu')} onClick={() => setDrawer(false)}>
                  <FiX aria-hidden />
                </IconButton>
              </div>
              <SidebarContent collapsed={false} onNavigate={() => setDrawer(false)} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-surface/80 px-3 backdrop-blur-md sm:px-4">
          <div className="flex items-center gap-2">
            <IconButton label={t('nav.openMenu')} className="lg:hidden" aria-expanded={drawer} aria-controls={DRAWER_ID} onClick={() => setDrawer(true)}>
              <FiMenu aria-hidden />
            </IconButton>
            <span className="hidden text-sm font-medium text-muted sm:block">{t('nav.headerLabel')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-surface-2 md:inline-flex"
            >
              <FiCommand aria-hidden />
              <span>{t('nav.command')}</span>
            </button>
            <LocaleSwitcher />
            <ThemeSwitcher />
            <IconButton label={t('nav.logout')} onClick={() => void logout()}>
              <FiLogOut aria-hidden />
            </IconButton>
          </div>
        </header>

        <main className="izl-scroll min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {status === 'loading' ? (
            <div className="grid place-items-center py-24">
              <Spinner label={t('cms.sessionLoading')} />
            </div>
          ) : (
            children
          )}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
