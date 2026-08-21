'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FiPlus } from 'react-icons/fi';
import { createRevision, listRevisions } from '@/lib/api/content';
import { useResource } from '@/lib/hooks/use-resource';
import { Button, Card, useToast } from '@/components/ui';
import { StatusBadge, Badge } from '@/components/ui/status-badge';
import { ResourceView, EmptyState } from '@/components/ui/states';
import { EntityFormDialog, type FormValues } from '@/components/forms/EntityFormDialog';
import { formatDateTime } from '@/lib/ui/format';

const s = (v?: string) => (v ?? '').trim();

/** Lesson revision list + create-new-DRAFT. A new revision is blank (backend authority). */
export function RevisionsPanel({ lessonId, publishedRevisionId, canAuthor }: { lessonId: string; publishedRevisionId: string | null; canAuthor: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const res = useResource(useCallback(() => listRevisions(lessonId), [lessonId]), [lessonId]);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Versiyalar</h3>
        {canAuthor && (
          <Button size="sm" variant="secondary" leftIcon={<FiPlus aria-hidden />} onClick={() => setCreating(true)}>
            Yangi versiya
          </Button>
        )}
      </div>

      <ResourceView
        loading={res.loading}
        error={res.error}
        data={res.data}
        onRetry={res.reload}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title="Versiya yo‘q" message="Bu darsda hali versiya yaratilmagan." />}
      >
        {(revisions) => (
          <ul className="space-y-2">
            {[...revisions]
              .sort((a, b) => b.version - a.version)
              .map((r) => (
                <li key={r.id}>
                  <Card className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-text">v{r.version}</span>
                        <span className="truncate text-sm text-muted">{r.title}</span>
                        <StatusBadge status={r.status} />
                        {publishedRevisionId === r.id && <Badge tone="success">Joriy</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs text-muted">
                        Yangilangan {formatDateTime(r.updatedAt)}
                        {r.publishedAt ? ` · Nashr ${formatDateTime(r.publishedAt)}` : ''}
                      </p>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => router.push(`/staff/content/revisions/${r.id}`)}>
                      Ochish
                    </Button>
                  </Card>
                </li>
              ))}
          </ul>
        )}
      </ResourceView>

      <EntityFormDialog
        open={creating}
        title="Yangi versiya"
        fields={[
          { name: 'title', label: 'Sarlavha', type: 'text', required: true },
          { name: 'description', label: 'Tavsif', type: 'textarea' },
        ]}
        onSubmit={async (v: FormValues) => {
          const rev = await createRevision(lessonId, { title: s(v.title), description: s(v.description) || undefined });
          toast('Versiya yaratildi', 'success');
          router.push(`/staff/content/revisions/${rev.id}`);
        }}
        onClose={() => setCreating(false)}
      />
    </div>
  );
}
