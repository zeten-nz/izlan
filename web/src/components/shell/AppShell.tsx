'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { FiFolder, FiLogOut, FiMenu, FiMoon, FiSun, FiX, FiShield } from 'react-icons/fi';
import { useAuth } from '@/lib/auth/auth-context';
import { useCms } from '@/lib/cms/cms-context';
import { useTheme } from '@/lib/theme/theme-context';
import { Button, IconButton, Spinner } from '@/components/ui';
import { Badge } from '@/components/ui/status-badge';
import { SubjectSwitcher } from './SubjectSwitcher';

function CapabilityChips() {
  const { capabilities } = useCms();
  return (
    <div className="flex flex-wrap gap-1.5">
      {capabilities.author && <Badge tone="primary">Muallif</Badge>}
      {capabilities.publish && <Badge tone="success">Nashr</Badge>}
      {capabilities.subjectManage && <Badge tone="warning">Fan boshqaruvi</Badge>}
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-5 p-4">
      <Link href="/staff/content" onClick={onNavigate} className="flex items-center gap-2 px-1 text-lg font-bold text-text">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-fg">Iz</span>
        Izlan Studio
      </Link>
      <SubjectSwitcher />
      <nav className="flex flex-col gap-1">
        <Link
          href="/staff/content"
          onClick={onNavigate}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-text hover:bg-surface-2"
        >
          <FiFolder aria-hidden /> Fanlar
        </Link>
      </nav>
      <div className="mt-auto space-y-2 border-t border-border pt-4">
        <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted">Ruxsatlar</p>
        <CapabilityChips />
      </div>
    </div>
  );
}

function AccessUnavailable() {
  const { logout } = useAuth();
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="max-w-md space-y-4 rounded-card border border-border bg-surface p-8 text-center">
        <FiShield className="mx-auto text-3xl text-muted" aria-hidden />
        <h1 className="text-lg font-semibold text-text">Content Studio ochilmadi</h1>
        <p className="text-sm text-muted">
          Sizning hisobingizda kontent muallifligi ruxsati yo‘q. Agar bu xato bo‘lsa, administrator bilan bog‘laning.
        </p>
        <Button variant="secondary" leftIcon={<FiLogOut aria-hidden />} onClick={() => void logout()}>
          Chiqish
        </Button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { status, reload } = useCms();
  const { logout, user } = useAuth();
  const { resolved, toggle } = useTheme();
  const [drawer, setDrawer] = useState(false);

  if (status === 'forbidden') return <AccessUnavailable />;
  if (status === 'error')
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <div className="space-y-3 text-center">
          <p className="text-sm text-muted">Sessiya ma’lumotini yuklab bo‘lmadi.</p>
          <Button variant="secondary" onClick={reload}>
            Qayta urinish
          </Button>
        </div>
      </div>
    );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-surface lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} aria-hidden />
          <div className="absolute left-0 top-0 h-full w-72 border-r border-border bg-surface">
            <div className="flex justify-end p-2">
              <IconButton label="Menyuni yopish" onClick={() => setDrawer(false)}>
                <FiX aria-hidden />
              </IconButton>
            </div>
            <SidebarContent onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur">
          <div className="flex items-center gap-2">
            <IconButton label="Menyu" className="lg:hidden" onClick={() => setDrawer(true)}>
              <FiMenu aria-hidden />
            </IconButton>
            <span className="text-sm font-medium text-muted">Kontent boshqaruvi</span>
          </div>
          <div className="flex items-center gap-2">
            <IconButton label={resolved === 'dark' ? 'Yorug‘ rejim' : 'Qorong‘i rejim'} onClick={toggle}>
              {resolved === 'dark' ? <FiSun aria-hidden /> : <FiMoon aria-hidden />}
            </IconButton>
            {user && <span className="hidden max-w-[10rem] truncate text-xs text-muted sm:block">{user.id.slice(0, 8)}…</span>}
            <IconButton label="Chiqish" onClick={() => void logout()}>
              <FiLogOut aria-hidden />
            </IconButton>
          </div>
        </header>

        <main className="izl-scroll min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {status === 'loading' ? (
            <div className="grid place-items-center py-24">
              <Spinner label="Sessiya yuklanmoqda…" />
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
