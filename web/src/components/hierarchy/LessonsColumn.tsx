'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { FiChevronRight, FiPlus, FiUploadCloud } from 'react-icons/fi';
import { ImportDialog } from '@/components/import/ImportDialog';
import { createLesson, listLessons } from '@/lib/api/content';
import { useResource } from '@/lib/hooks/use-resource';
import { useCapabilities } from '@/lib/cms/cms-context';
import { useT } from '@/lib/i18n/i18n-context';
import { Button, Card, useToast } from '@/components/ui';
import { StatusBadge } from '@/components/ui/status-badge';
import { ResourceView, EmptyState } from '@/components/ui/states';
import { EntityFormDialog, type FormValues } from '@/components/forms/EntityFormDialog';
import { listItem } from '@/lib/motion/motion';

/** Leaf level: lessons under a topic. Selecting a lesson navigates to its workspace. */
export function LessonsColumn({ topicId }: { topicId: string }) {
  const router = useRouter();
  const caps = useCapabilities();
  const t = useT();
  const { toast } = useToast();
  const res = useResource(useCallback(() => listLessons(topicId), [topicId]), [topicId]);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  async function onCreate(v: FormValues) {
    await createLesson(topicId, { contentKey: (v.contentKey ?? '').trim(), sortOrder: Number(v.sortOrder ?? '0') || 0, slug: v.slug?.trim() ? v.slug.trim() : undefined });
    toast(t('hierarchy.lessonCreated'), 'success');
    res.reload();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{t('hierarchy.lessons')}</h3>
        {caps.author && (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" leftIcon={<FiUploadCloud aria-hidden />} onClick={() => setImporting(true)}>
              {t('import.open')}
            </Button>
            <Button size="sm" variant="secondary" leftIcon={<FiPlus aria-hidden />} onClick={() => setCreating(true)}>
              {t('hierarchy.addLesson')}
            </Button>
          </div>
        )}
      </div>

      <ResourceView
        loading={res.loading}
        error={res.error}
        data={res.data}
        onRetry={res.reload}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title={t('hierarchy.lessons')} message={t('hierarchy.lessonsEmptyBody')} />}
      >
        {(lessons) => (
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {lessons.map((l) => (
                <motion.li key={l.id} variants={listItem} initial="initial" animate="animate" exit="exit">
                  <Card className="p-0 transition-colors hover:border-primary/50">
                    <button type="button" onClick={() => router.push(`/staff/content/lessons/${l.id}`)} className="flex w-full items-center gap-2 p-3 text-left">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-text">{l.contentKey}</span>
                          <StatusBadge status={l.status} />
                        </div>
                        <span className="truncate text-xs text-muted">
                          {l.slug ? `/${l.slug}` : t('hierarchy.noSlug')} · {t('hierarchy.metaOrder', { n: l.sortOrder })}
                        </span>
                      </div>
                      <FiChevronRight className="shrink-0 text-muted" aria-hidden />
                    </button>
                  </Card>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </ResourceView>

      <EntityFormDialog
        open={creating}
        title={t('hierarchy.newLesson')}
        fields={[
          { name: 'contentKey', label: t('hierarchy.contentKey'), type: 'text', required: true, hint: t('hierarchy.contentKeyHint') },
          { name: 'slug', label: t('subjects.slug'), type: 'text', hint: t('common.optional') },
          { name: 'sortOrder', label: t('common.order'), type: 'number', required: true, placeholder: '0' },
        ]}
        onSubmit={onCreate}
        onClose={() => setCreating(false)}
      />

      <ImportDialog topicId={topicId} open={importing} onClose={() => setImporting(false)} onImported={res.reload} />
    </div>
  );
}
