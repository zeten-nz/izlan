'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { useT } from '@/lib/i18n/i18n-context';
import { Spinner } from '@/components/ui';

/**
 * Learner route guard. Waits for auth bootstrap to resolve, then:
 *  - unauthenticated → redirect to /login (with a safe local `next` = current path),
 *  - loading/redirecting → a spinner (NO authenticated-content flash for unauthenticated users).
 * Onboarding-completeness routing is handled per page (dashboard shows a continue state; /onboarding redirects when done).
 */
export function LearnerGuard({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const t = useT();

  useEffect(() => {
    if (status === 'unauthenticated') {
      const next = pathname && pathname !== '/login' ? `?next=${encodeURIComponent(pathname)}` : '';
      router.replace(`/login${next}`);
    }
  }, [status, pathname, router]);

  if (status !== 'authenticated') {
    return (
      <div className="grid min-h-[60vh] place-items-center" role="status" aria-live="polite">
        <Spinner label={t('learner.common.loading')} />
      </div>
    );
  }
  return <>{children}</>;
}
