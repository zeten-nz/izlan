'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { CmsProvider } from '@/lib/cms/cms-context';
import { AppShell } from '@/components/shell/AppShell';
import { Spinner } from '@/components/ui';

/** Authenticated CMS area. Waits for auth bootstrap (§7) before deciding; unauthenticated → /staff/login. */
export default function ContentLayout({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/staff/login');
  }, [status, router]);

  if (status !== 'authenticated') {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner label="Tekshirilmoqda…" />
      </div>
    );
  }

  return (
    <CmsProvider>
      <AppShell>{children}</AppShell>
    </CmsProvider>
  );
}
