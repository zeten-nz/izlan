'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';
import { Spinner } from '@/components/ui';
import { useT } from '@/lib/i18n/i18n-context';

/**
 * /staff entry point (Phase 07A). Uses the shared auth bootstrap authority — NO role-name checks. An unauthenticated
 * visitor is sent to the staff login; an authenticated one enters the CMS home (`/staff/content`), where CMS capability
 * is still enforced by the layout guard + the backend. Fixes the prior /staff → 404 gap.
 */
export default function StaffIndexPage() {
  const { status } = useAuth();
  const router = useRouter();
  const t = useT();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/staff/login');
    else if (status === 'authenticated') router.replace('/staff/content');
  }, [status, router]);

  return (
    <div className="grid min-h-screen place-items-center bg-bg">
      <Spinner label={t('cms.checking')} />
    </div>
  );
}
