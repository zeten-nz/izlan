'use client';

import type { ReactNode } from 'react';
import { FiInbox, FiAlertCircle, FiRefreshCw } from 'react-icons/fi';
import { ApiError } from '@/lib/api/errors';
import { Button, Skeleton } from './primitives';

export function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Yuklanmoqda">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ title, message, action }: { title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-border px-6 py-12 text-center">
      <FiInbox className="text-2xl text-muted" aria-hidden />
      <p className="font-medium text-text">{title}</p>
      {message && <p className="max-w-sm text-sm text-muted">{message}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return 'Topilmadi yoki sizga biriktirilmagan.';
    if (error.status === 403) return 'Ruxsat yo‘q.';
    if (error.status === 401) return 'Sessiya tugagan. Qayta kiring.';
    return `Xatolik (${error.code}).`;
  }
  return 'Tarmoq xatosi. Qayta urinib ko‘ring.';
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-danger/30 bg-danger/5 px-6 py-10 text-center">
      <FiAlertCircle className="text-2xl text-danger" aria-hidden />
      <p className="text-sm text-text">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" leftIcon={<FiRefreshCw aria-hidden />} onClick={onRetry}>
          Qayta yuklash
        </Button>
      )}
    </div>
  );
}

/** Read-resource wrapper: renders loading / error(retry) / empty / content consistently. */
export function ResourceView<T>({
  loading,
  error,
  data,
  onRetry,
  isEmpty,
  empty,
  children,
}: {
  loading: boolean;
  error: unknown | null;
  data: T | null;
  onRetry?: () => void;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (loading && data === null) return <LoadingRows />;
  if (error && data === null) return <ErrorState error={error} onRetry={onRetry} />;
  if (data === null) return <LoadingRows />;
  if (isEmpty && isEmpty(data) && empty) return <>{empty}</>;
  return <>{children(data)}</>;
}
