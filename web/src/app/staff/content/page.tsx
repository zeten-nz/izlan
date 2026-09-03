'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { FiPlus, FiChevronRight, FiTrash2 } from 'react-icons/fi';
import { createSubject, deleteSubject, listSubjects } from '@/lib/api/content';
import type { Subject } from '@/lib/api/types';
import { useResource } from '@/lib/hooks/use-resource';
import { useCapabilities } from '@/lib/cms/cms-context';
import { useT } from '@/lib/i18n/i18n-context';
import { useToast, IconButton } from '@/components/ui';
import { Button, Card } from '@/components/ui';
import { StatusBadge } from '@/components/ui/status-badge';
import { ConfirmDialog } from '@/components/ui/dialog';
import { ResourceView, EmptyState } from '@/components/ui/states';
import { EntityFormDialog, type FormValues } from '@/components/forms/EntityFormDialog';
import { describeError } from '@/lib/ui/error-text';
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
                <SubjectCard subject={s} canManage={caps.subjectManage} onChanged={() => res.reload()} />
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

/**
 * A subject card whose PRIMARY action is opening the subject (the Link). Delete is a SECONDARY, danger-styled action
 * (shown only to subject managers) that opens a confirmation dialog and never navigates. The backend authoritatively
 * decides DELETED / ARCHIVED / BLOCKED — the UI reports the real outcome accurately and never pretends data was
 * deleted when it was only archived.
 */
function SubjectCard({ subject, canManage, onChanged }: { subject: Subject; canManage: boolean; onChanged: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onConfirm() {
    setBusy(true);
    try {
      const r = await deleteSubject(subject.id);
      if (r.outcome === 'DELETED') {
        toast(t('subjects.deleted', { title: subject.title }), 'success');
        setConfirming(false);
        onChanged(); // list changed → refresh
      } else if (r.outcome === 'ARCHIVED') {
        toast(t('subjects.archived', { title: subject.title }), 'info'); // accurate: archived, NOT deleted
        setConfirming(false);
        onChanged();
      } else {
        // BLOCKED — nothing changed; show the human-readable reason and keep the list as-is (no stale optimistic state).
        toast(t('subjects.blockedHistory', { title: subject.title }), 'error');
        setConfirming(false);
      }
    } catch (e) {
      toast(describeError(e, t), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <Link href={`/staff/content/subjects/${subject.id}`}>
        <Card className="flex items-center justify-between gap-3 p-4 transition-all hover:border-primary/60 hover:shadow-[0_0_0_1px_rgb(var(--color-primary)/0.25)]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-semibold text-text">{subject.title}</h2>
              <StatusBadge status={subject.status} />
            </div>
            <p className="truncate text-xs text-muted">/{subject.slug}</p>
            <p className="mt-1 text-xs text-muted">
              {t('common.updatedAt')}: {formatDateTime(subject.updatedAt)}
            </p>
          </div>
          {/* leave room for the absolutely-positioned action so it never overlaps the chevron */}
          <FiChevronRight className="mr-9 shrink-0 text-muted" aria-hidden />
        </Card>
      </Link>
      {canManage && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <IconButton
            label={t('subjects.deleteAction')}
            variant="danger"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setConfirming(true);
            }}
          >
            <FiTrash2 aria-hidden />
          </IconButton>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={onConfirm}
        title={t('subjects.deleteTitle')}
        message={
          <span className="flex flex-col gap-2">
            <span>{t('subjects.deleteBody', { title: subject.title })}</span>
            <span className="text-xs">{t('subjects.deleteHint')}</span>
          </span>
        }
        confirmLabel={t('subjects.deleteAction')}
        danger
        busy={busy}
      />
    </div>
  );
}
