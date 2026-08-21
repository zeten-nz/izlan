'use client';

import { useRouter, useParams } from 'next/navigation';
import { useCallback } from 'react';
import { FiBookOpen } from 'react-icons/fi';
import { listSubjects } from '@/lib/api/content';
import { useResource } from '@/lib/hooks/use-resource';
import { Select } from '@/components/ui';

/** Assigned-subject selector (authority = GET /subjects). Navigates to the chosen subject workspace. */
export function SubjectSwitcher() {
  const router = useRouter();
  const params = useParams<{ subjectId?: string }>();
  const current = params?.subjectId ?? '';
  const { data, loading } = useResource(useCallback(() => listSubjects(), []), []);

  if (loading) return <div className="h-10 w-full animate-pulse rounded-lg bg-surface-2" />;
  const subjects = data ?? [];
  if (subjects.length === 0) return <p className="px-1 text-xs text-muted">Biriktirilgan fan yo‘q</p>;

  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 px-1 text-xs font-medium uppercase tracking-wide text-muted">
        <FiBookOpen aria-hidden /> Fan
      </span>
      <Select
        value={current}
        onChange={(e) => {
          const id = e.target.value;
          if (id) router.push(`/staff/content/subjects/${id}`);
        }}
        aria-label="Fanni tanlash"
      >
        <option value="" disabled>
          Fanni tanlang…
        </option>
        {subjects.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title}
          </option>
        ))}
      </Select>
    </label>
  );
}
