'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FiChevronRight, FiPlus } from 'react-icons/fi';
import { createLesson, listLessons } from '@/lib/api/content';
import { useResource } from '@/lib/hooks/use-resource';
import { useCapabilities } from '@/lib/cms/cms-context';
import { Button, Card, useToast } from '@/components/ui';
import { StatusBadge } from '@/components/ui/status-badge';
import { ResourceView, EmptyState } from '@/components/ui/states';
import { EntityFormDialog, type FormValues } from '@/components/forms/EntityFormDialog';

/** Leaf level: lessons under a topic. Selecting a lesson navigates to its workspace. */
export function LessonsColumn({ topicId }: { topicId: string }) {
  const router = useRouter();
  const caps = useCapabilities();
  const { toast } = useToast();
  const res = useResource(useCallback(() => listLessons(topicId), [topicId]), [topicId]);
  const [creating, setCreating] = useState(false);

  async function onCreate(v: FormValues) {
    await createLesson(topicId, {
      contentKey: (v.contentKey ?? '').trim(),
      sortOrder: Number(v.sortOrder ?? '0') || 0,
      slug: v.slug?.trim() ? v.slug.trim() : undefined,
    });
    toast('Dars yaratildi', 'success');
    res.reload();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Darslar</h3>
        {caps.author && (
          <Button size="sm" variant="secondary" leftIcon={<FiPlus aria-hidden />} onClick={() => setCreating(true)}>
            Dars qo‘shish
          </Button>
        )}
      </div>

      <ResourceView
        loading={res.loading}
        error={res.error}
        data={res.data}
        onRetry={res.reload}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title="Dars yo‘q" message="Bu mavzuda hali dars yaratilmagan." />}
      >
        {(lessons) => (
          <ul className="space-y-2">
            {lessons.map((l) => (
              <li key={l.id}>
                <Card className="p-0">
                  <button
                    type="button"
                    onClick={() => router.push(`/staff/content/lessons/${l.id}`)}
                    className="flex w-full items-center gap-2 p-3 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-text">{l.contentKey}</span>
                        <StatusBadge status={l.status} />
                      </div>
                      <span className="truncate text-xs text-muted">{l.slug ? `/${l.slug}` : 'slug yo‘q'} · tartib {l.sortOrder}</span>
                    </div>
                    <FiChevronRight className="shrink-0 text-muted" aria-hidden />
                  </button>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </ResourceView>

      <EntityFormDialog
        open={creating}
        title="Yangi dars"
        fields={[
          { name: 'contentKey', label: 'Content key', type: 'text', required: true, hint: 'O‘zgarmas biznes identifikatori (keyin o‘zgarmaydi).' },
          { name: 'slug', label: 'Slug', type: 'text', hint: 'ixtiyoriy' },
          { name: 'sortOrder', label: 'Tartib raqami', type: 'number', required: true, placeholder: '0' },
        ]}
        onSubmit={onCreate}
        onClose={() => setCreating(false)}
      />
    </div>
  );
}
