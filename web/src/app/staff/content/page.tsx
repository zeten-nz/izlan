'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { FiPlus, FiChevronRight } from 'react-icons/fi';
import { createSubject, listSubjects } from '@/lib/api/content';
import { useResource } from '@/lib/hooks/use-resource';
import { useCapabilities } from '@/lib/cms/cms-context';
import { useT } from '@/lib/i18n/i18n-context';
import { useToast } from '@/components/ui';
import { Button, Card } from '@/components/ui';
import { StatusBadge } from '@/components/ui/status-badge';
import { ResourceView, EmptyState } from '@/components/ui/states';
import { EntityFormDialog, type FormValues } from '@/components/forms/EntityFormDialog';
import { formatDateTime } from '@/lib/ui/format';
import { fadeInUp } from '@/lib/motion/motion';

export default function SubjectsPage() {
  const caps = useCapabilities();
  const t = useT();
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
    toast(t('subjects.created'), 'success');
    res.reload();
  }

  return (
    <motion.div variants={fadeInUp} initial="initial" animate="animate" className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text">{t('subjects.title')}</h1>
          <p className="text-sm text-muted">{t('subjects.subtitle')}</p>
        </div>
        {caps.subjectManage && (
          <Button leftIcon={<FiPlus aria-hidden />} onClick={() => setCreating(true)}>
            {t('subjects.create')}
          </Button>
        )}
      </div>

      <ResourceView
        loading={res.loading}
        error={res.error}
        data={res.data}
        onRetry={res.reload}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title={t('subjects.emptyTitle')} message={t('subjects.emptyBody')} />}
      >
        {(subjects) => (
          <div className="grid gap-3 sm:grid-cols-2">
            {subjects.map((s, i) => (
              <motion.div key={s.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.2), duration: 0.2 }}>
                <Link href={`/staff/content/subjects/${s.id}`}>
                  <Card className="flex items-center justify-between gap-3 p-4 transition-all hover:border-primary/60 hover:shadow-[0_0_0_1px_rgb(var(--color-primary)/0.25)]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate font-semibold text-text">{s.title}</h2>
                        <StatusBadge status={s.status} />
                      </div>
                      <p className="truncate text-xs text-muted">/{s.slug}</p>
                      <p className="mt-1 text-xs text-muted">
                        {t('common.updatedAt')}: {formatDateTime(s.updatedAt)}
                      </p>
                    </div>
                    <FiChevronRight className="shrink-0 text-muted" aria-hidden />
                  </Card>
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </ResourceView>

      <EntityFormDialog
        open={creating}
        title={t('subjects.newTitle')}
        fields={[
          { name: 'slug', label: t('subjects.slug'), type: 'text', required: true, placeholder: t('subjects.slugPlaceholder'), hint: t('subjects.slugHint') },
          { name: 'title', label: t('subjects.fieldTitle'), type: 'text', required: true },
          { name: 'description', label: t('subjects.description'), type: 'textarea' },
          { name: 'sortOrder', label: t('common.order'), type: 'number', placeholder: '0' },
        ]}
        onSubmit={onCreate}
        onClose={() => setCreating(false)}
      />
    </motion.div>
  );
}
