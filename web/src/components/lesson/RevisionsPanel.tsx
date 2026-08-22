'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { FiPlus } from 'react-icons/fi';
import { createRevision, listRevisions } from '@/lib/api/content';
import { useResource } from '@/lib/hooks/use-resource';
import { useT } from '@/lib/i18n/i18n-context';
import { Button, Card, useToast } from '@/components/ui';
import { StatusBadge, Badge } from '@/components/ui/status-badge';
import { ResourceView, EmptyState } from '@/components/ui/states';
import { EntityFormDialog, type FormValues } from '@/components/forms/EntityFormDialog';
import { formatDateTime } from '@/lib/ui/format';
import { listItem } from '@/lib/motion/motion';

const s = (v?: string) => (v ?? '').trim();

/** Lesson revision list + create-new-DRAFT. A new revision is blank (backend authority). */
export function RevisionsPanel({ lessonId, publishedRevisionId, canAuthor }: { lessonId: string; publishedRevisionId: string | null; canAuthor: boolean }) {
  const router = useRouter();
  const t = useT();
  const { toast } = useToast();
  const res = useResource(useCallback(() => listRevisions(lessonId), [lessonId]), [lessonId]);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{t('revision.versionsTitle')}</h3>
        {canAuthor && (
          <Button size="sm" variant="secondary" leftIcon={<FiPlus aria-hidden />} onClick={() => setCreating(true)}>
            {t('revision.newVersion')}
          </Button>
        )}
      </div>

      <ResourceView
        loading={res.loading}
        error={res.error}
        data={res.data}
        onRetry={res.reload}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title={t('revision.emptyTitle')} message={t('revision.emptyBody')} />}
      >
        {(revisions) => (
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {[...revisions]
                .sort((a, b) => b.version - a.version)
                .map((r) => (
                  <motion.li key={r.id} variants={listItem} initial="initial" animate="animate" exit="exit">
                    <Card className="flex items-center justify-between gap-3 p-3 transition-colors hover:border-primary/50">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-text">v{r.version}</span>
                          <span className="truncate text-sm text-muted">{r.title}</span>
                          <StatusBadge status={r.status} />
                          {publishedRevisionId === r.id && <Badge tone="success">{t('revision.current')}</Badge>}
                        </div>
                        <p className="mt-0.5 text-xs text-muted">
                          {t('revision.updatedShort', { t: formatDateTime(r.updatedAt) })}
                          {r.publishedAt ? ` · ${t('revision.publishedShort', { t: formatDateTime(r.publishedAt) })}` : ''}
                        </p>
                      </div>
                      <Button size="sm" variant="secondary" onClick={() => router.push(`/staff/content/revisions/${r.id}`)}>
                        {t('revision.open')}
                      </Button>
                    </Card>
                  </motion.li>
                ))}
            </AnimatePresence>
          </ul>
        )}
      </ResourceView>

      <EntityFormDialog
        open={creating}
        title={t('revision.newVersion')}
        fields={[
          { name: 'title', label: t('revision.title'), type: 'text', required: true },
          { name: 'description', label: t('revision.description'), type: 'textarea' },
        ]}
        onSubmit={async (v: FormValues) => {
          const rev = await createRevision(lessonId, { title: s(v.title), description: s(v.description) || undefined });
          toast(t('revision.versionCreated'), 'success');
          router.push(`/staff/content/revisions/${rev.id}`);
        }}
        onClose={() => setCreating(false)}
      />
    </div>
  );
}
