'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { FiPlus, FiChevronRight } from 'react-icons/fi';
import { createSubject, listSubjects } from '@/lib/api/content';
import { useResource } from '@/lib/hooks/use-resource';
import { useCapabilities } from '@/lib/cms/cms-context';
import { useToast } from '@/components/ui';
import { Button, Card } from '@/components/ui';
import { StatusBadge } from '@/components/ui/status-badge';
import { ResourceView, EmptyState } from '@/components/ui/states';
import { EntityFormDialog, type FormValues } from '@/components/forms/EntityFormDialog';
import { formatDateTime } from '@/lib/ui/format';

export default function SubjectsPage() {
  const caps = useCapabilities();
  const { toast } = useToast();
  const res = useResource(useCallback(() => listSubjects(), []), []);
  const [creating, setCreating] = useState(false);

  async function onCreate(v: FormValues) {
    await createSubject({
      slug: (v.slug ?? '').trim(),
      title: (v.title ?? '').trim(),
      description: v.description?.trim() ? v.description.trim() : undefined,
      sortOrder: v.sortOrder ? Number(v.sortOrder) : undefined,
    });
    toast('Fan yaratildi', 'success');
    res.reload();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text">Fanlar</h1>
          <p className="text-sm text-muted">Sizga biriktirilgan fanlar</p>
        </div>
        {caps.subjectManage && (
          <Button leftIcon={<FiPlus aria-hidden />} onClick={() => setCreating(true)}>
            Fan yaratish
          </Button>
        )}
      </div>

      <ResourceView
        loading={res.loading}
        error={res.error}
        data={res.data}
        onRetry={res.reload}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title="Fan yo‘q" message="Sizga hali fan biriktirilmagan yoki hech qanday fan yaratilmagan." />}
      >
        {(subjects) => (
          <div className="grid gap-3 sm:grid-cols-2">
            {subjects.map((s) => (
              <Link key={s.id} href={`/staff/content/subjects/${s.id}`}>
                <Card className="flex items-center justify-between gap-3 p-4 transition-colors hover:border-primary">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate font-semibold text-text">{s.title}</h2>
                      <StatusBadge status={s.status} />
                    </div>
                    <p className="truncate text-xs text-muted">/{s.slug}</p>
                    <p className="mt-1 text-xs text-muted">Yangilangan: {formatDateTime(s.updatedAt)}</p>
                  </div>
                  <FiChevronRight className="shrink-0 text-muted" aria-hidden />
                </Card>
              </Link>
            ))}
          </div>
        )}
      </ResourceView>

      <EntityFormDialog
        open={creating}
        title="Yangi fan"
        fields={[
          { name: 'slug', label: 'Slug', type: 'text', required: true, placeholder: 'ingliz-tili', hint: 'kichik harflar va chiziqcha' },
          { name: 'title', label: 'Sarlavha', type: 'text', required: true },
          { name: 'description', label: 'Tavsif', type: 'textarea' },
          { name: 'sortOrder', label: 'Tartib raqami', type: 'number', placeholder: '0' },
        ]}
        onSubmit={onCreate}
        onClose={() => setCreating(false)}
      />
    </div>
  );
}
