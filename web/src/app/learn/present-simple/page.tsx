'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui';

/**
 * Legacy pilot route. The V2 roadmap is now the generic `/learn/roadmap` (subject/point-driven, not Present-Simple
 * specific). This thin redirect keeps any old bookmarks/links working; nothing product-facing points here anymore.
 */
export default function PresentSimpleRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/learn/roadmap');
  }, [router]);
  return <div className="grid min-h-[50vh] place-items-center"><Spinner /></div>;
}
