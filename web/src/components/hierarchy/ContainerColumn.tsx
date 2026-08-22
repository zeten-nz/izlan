'use client';

import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FiChevronRight, FiEdit2, FiPlus, FiUploadCloud } from 'react-icons/fi';
import { useResource } from '@/lib/hooks/use-resource';
import { useT } from '@/lib/i18n/i18n-context';
import { Button, Card, IconButton, useToast } from '@/components/ui';
import { StatusBadge } from '@/components/ui/status-badge';
import { ResourceView, EmptyState } from '@/components/ui/states';
import { EntityFormDialog, type FieldSpec, type FormValues } from '@/components/forms/EntityFormDialog';
import { describeError } from '@/lib/ui/error-text';
import { listItem } from '@/lib/motion/motion';

export interface ContainerEntity {
  id: string;
  status: string;
  updatedAt: string;
}

export interface ContainerColumnProps<E extends ContainerEntity> {
  heading: string;
  reloadKey: string;
  loader: () => Promise<E[]>;
  title: (e: E) => string;
  meta: (e: E) => string;
  onSelect: (e: E) => void;
  createLabel: string;
  createFields: FieldSpec[];
  onCreate: (values: FormValues) => Promise<void>;
  canManage: boolean;
  editFields: FieldSpec[];
  toInitial: (e: E) => FormValues;
  onEdit: (e: E, values: FormValues) => Promise<void>;
  canPublish: boolean;
  onPublish: (e: E) => Promise<void>;
}

/** One drill-down level of the content hierarchy: list + create + edit(DRAFT) + publish(DRAFT) + select-to-drill. */
export function ContainerColumn<E extends ContainerEntity>(props: ContainerColumnProps<E>) {
  const t = useT();
  const { toast } = useToast();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const res = useResource(useCallback(() => props.loader(), [props.reloadKey]), [props.reloadKey]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<E | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);

  async function doPublish(e: E) {
    setPublishingId(e.id);
    try {
      await props.onPublish(e);
      toast(t('hierarchy.published'), 'success');
      res.reload();
    } catch (err) {
      toast(describeError(err, t), 'error');
      res.reload(); // conflict/lifecycle → refresh to latest server state (never auto-retry)
    } finally {
      setPublishingId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{props.heading}</h3>
        {props.canManage && (
          <Button size="sm" variant="secondary" leftIcon={<FiPlus aria-hidden />} onClick={() => setCreating(true)}>
            {props.createLabel}
          </Button>
        )}
      </div>

      <ResourceView
        loading={res.loading}
        error={res.error}
        data={res.data}
        onRetry={res.reload}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title={t('hierarchy.emptyTitle')} message={t('hierarchy.emptyBody')} />}
      >
        {(items) => (
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {items.map((e) => (
                <motion.li key={e.id} variants={listItem} initial="initial" animate="animate" exit="exit">
                  <Card className="flex items-center gap-2 p-3 transition-colors hover:border-primary/50">
                    <button type="button" onClick={() => props.onSelect(e)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-text">{props.title(e)}</span>
                          <StatusBadge status={e.status} />
                        </div>
                        <span className="truncate text-xs text-muted">{props.meta(e)}</span>
                      </div>
                      <FiChevronRight className="shrink-0 text-muted" aria-hidden />
                    </button>
                    {props.canManage && e.status === 'DRAFT' && (
                      <IconButton label={t('common.edit')} onClick={() => setEditing(e)}>
                        <FiEdit2 aria-hidden />
                      </IconButton>
                    )}
                    {props.canPublish && e.status === 'DRAFT' && (
                      <IconButton label={t('workflow.publish')} onClick={() => void doPublish(e)} disabled={publishingId === e.id}>
                        <FiUploadCloud aria-hidden />
                      </IconButton>
                    )}
                  </Card>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </ResourceView>

      <EntityFormDialog
        open={creating}
        title={props.createLabel}
        fields={props.createFields}
        onSubmit={async (v) => {
          await props.onCreate(v);
          toast(t('common.created'), 'success');
          res.reload();
        }}
        onClose={() => setCreating(false)}
      />
      <EntityFormDialog
        open={editing !== null}
        title={t('hierarchy.editTitle')}
        fields={props.editFields}
        initial={editing ? props.toInitial(editing) : {}}
        onSubmit={async (v) => {
          if (editing) {
            await props.onEdit(editing, v);
            toast(t('common.saved'), 'success');
            res.reload();
          }
        }}
        onClose={() => setEditing(null)}
        onConflictReload={res.reload}
      />
    </div>
  );
}
