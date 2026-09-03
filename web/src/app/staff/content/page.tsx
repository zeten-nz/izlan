'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, Reorder, useDragControls } from 'framer-motion';
import { FiPlus, FiChevronRight, FiMenu } from 'react-icons/fi';
import { listSubjects, reorderSubjects } from '@/lib/api/content';
import type { Subject } from '@/lib/api/types';
import { useResource } from '@/lib/hooks/use-resource';
import { useCapabilities } from '@/lib/cms/cms-context';
import { useT } from '@/lib/i18n/i18n-context';
import { useToast } from '@/components/ui';
import { Button, Card } from '@/components/ui';
import { StatusBadge } from '@/components/ui/status-badge';
import { ResourceView, EmptyState } from '@/components/ui/states';
import { SubjectCreateDialog } from '@/components/subject/SubjectCreateDialog';
import { describeError } from '@/lib/ui/error-text';
import { formatDateTime } from '@/lib/ui/format';
import { fadeInUp } from '@/lib/motion/motion';

export default function SubjectsPage() {
  const caps = useCapabilities();
  const t = useT();
  const res = useResource(useCallback(() => listSubjects(), []), []);
  const [creating, setCreating] = useState(false);

  return (
    <motion.div variants={fadeInUp} initial="initial" animate="animate" className="mx-auto max-w-3xl space-y-5">
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
        {(subjects) => <SubjectList subjects={subjects} canReorder={caps.subjectManage} onReorderPersisted={() => res.reload()} />}
      </ResourceView>

      <SubjectCreateDialog open={creating} onClose={() => setCreating(false)} onCreated={() => res.reload()} />
    </motion.div>
  );
}

/**
 * The canonical subject list. Order comes from the server (array order). Managers can drag rows by the handle to
 * reorder; the new order is sent to the backend and the list is re-synced from the server on success. The row itself
 * stays a navigation Link — only the handle initiates a drag, so reordering never competes with opening a subject.
 */
function SubjectList({ subjects, canReorder, onReorderPersisted }: { subjects: Subject[]; canReorder: boolean; onReorderPersisted: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const [items, setItems] = useState<Subject[]>(subjects);
  const [saving, setSaving] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Keep local order in sync when the server data changes (create/reload).
  useEffect(() => { setItems(subjects); }, [subjects]);

  async function persist() {
    const orderedIds = itemsRef.current.map((s) => s.id);
    if (orderedIds.length < 2) return;
    setSaving(true);
    try {
      await reorderSubjects(orderedIds);
      toast(t('subjects.reordered'), 'success');
      onReorderPersisted(); // re-sync canonical order from the server
    } catch (e) {
      toast(describeError(e, t), 'error');
      onReorderPersisted(); // revert optimistic order to server truth
    } finally {
      setSaving(false);
    }
  }

  if (!canReorder) {
    return (
      <div className="space-y-2">
        {items.map((s) => (
          <SubjectRow key={s.id} subject={s} draggable={false} />
        ))}
      </div>
    );
  }

  return (
    <Reorder.Group as="div" axis="y" values={items} onReorder={setItems} className="space-y-2" aria-busy={saving}>
      {items.map((s) => (
        <SubjectRow key={s.id} subject={s} draggable onDragEnd={persist} />
      ))}
    </Reorder.Group>
  );
}

function SubjectRow({ subject, draggable, onDragEnd }: { subject: Subject; draggable: boolean; onDragEnd?: () => void }) {
  const t = useT();
  const controls = useDragControls();

  const card = (
    <Card className="flex items-center gap-3 p-4 transition-all hover:border-primary/60 hover:shadow-[0_0_0_1px_rgb(var(--color-primary)/0.25)]">
      {draggable && (
        <button
          type="button"
          aria-label={t('subjects.reorderHandle')}
          onPointerDown={(e) => { e.preventDefault(); controls.start(e); }}
          className="shrink-0 cursor-grab touch-none rounded-md p-1 text-muted hover:text-text active:cursor-grabbing"
        >
          <FiMenu aria-hidden />
        </button>
      )}
      <Link href={`/staff/content/subjects/${subject.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-semibold text-text">{subject.title}</h2>
            <StatusBadge status={subject.status} />
          </div>
          <p className="truncate text-xs text-muted">/{subject.slug}</p>
          <p className="mt-1 text-xs text-muted">{t('common.updatedAt')}: {formatDateTime(subject.updatedAt)}</p>
        </div>
        <FiChevronRight className="shrink-0 text-muted" aria-hidden />
      </Link>
    </Card>
  );

  if (!draggable) return card;
  return (
    <Reorder.Item value={subject} dragListener={false} dragControls={controls} onDragEnd={onDragEnd}>
      {card}
    </Reorder.Item>
  );
}
