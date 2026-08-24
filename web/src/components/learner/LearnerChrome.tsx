'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { FiBookOpen, FiHome, FiLogOut, FiUser } from 'react-icons/fi';
import { useAuth } from '@/lib/auth/auth-context';
import { useT } from '@/lib/i18n/i18n-context';
import { LocaleSwitcher } from '@/components/shell/LocaleSwitcher';
import { ThemeToggle } from './ThemeToggle';

const NAV = [
  { href: '/learn', key: 'home', icon: FiHome, exact: true },
  { href: '/learn/subjects', key: 'subjects', icon: FiBookOpen, exact: false },
  { href: '/learn/profile', key: 'profile', icon: FiUser, exact: false },
] as const;

function isActive(pathname: string, href: string, exact: boolean): boolean {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Authenticated learner shell — a calm top bar on desktop and a compact bottom navigation on mobile. Deliberately NOT
 * the dense staff CMS sidebar. Branding is "Izlan" (never "Izlan Studio").
 */
export function LearnerChrome({ children }: { children: React.ReactNode }) {
  const t = useT();
  const pathname = usePathname() ?? '/learn';
  const router = useRouter();
  const { logout } = useAuth();

  async function onLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-4 px-4">
          <Link href="/learn" className="text-lg font-bold tracking-tight text-text">
            {t('learner.nav.brand')}
          </Link>
          <nav className="ml-4 hidden items-center gap-1 sm:flex" aria-label={t('learner.nav.brand')}>
            {NAV.map((n) => {
              const active = isActive(pathname, n.href, n.exact);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${active ? 'bg-surface-2 text-text' : 'text-muted hover:bg-surface-2 hover:text-text'}`}
                >
                  {t(`learner.nav.${n.key}`)}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <LocaleSwitcher />
            <ThemeToggle />
            <button
              type="button"
              onClick={onLogout}
              className="hidden items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-text sm:inline-flex"
            >
              <FiLogOut aria-hidden /> {t('learner.nav.logout')}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-6 sm:pb-10">{children}</main>

      {/* Mobile bottom navigation */}
      <nav
        aria-label={t('learner.nav.brand')}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur sm:hidden"
      >
        <div className="mx-auto grid max-w-5xl grid-cols-3">
          {NAV.map((n) => {
            const active = isActive(pathname, n.href, n.exact);
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors ${active ? 'text-primary' : 'text-muted'}`}
              >
                <Icon className="text-lg" aria-hidden />
                {t(`learner.nav.${n.key}`)}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
