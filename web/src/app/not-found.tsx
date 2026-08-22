'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n/i18n-context';
import { Button } from '@/components/ui';

/** Izlan-styled not-found. Does not reveal internal route structure; offers safe navigation only. */
export default function NotFound() {
  const t = useT();
  return (
    <div className="grid min-h-screen place-items-center bg-bg px-4 text-center">
      <div className="max-w-md">
        <p className="text-5xl font-bold tracking-tight text-primary">404</p>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-text">{t('learner.common.notFoundTitle')}</h1>
        <p className="mt-2 text-muted">{t('learner.common.notFoundBody')}</p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/"><Button>{t('learner.common.backHome')}</Button></Link>
          <Link href="/login"><Button variant="secondary">{t('landing.signIn')}</Button></Link>
        </div>
      </div>
    </div>
  );
}
