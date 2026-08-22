'use client';

import { useCallback, useEffect, useState } from 'react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FiChevronDown, FiChevronUp, FiMove, FiPlus } from 'react-icons/fi';
import type { Activity, ActivityType } from '@/lib/api/types';
import { createActivity, listActivities, reorderActivities } from '@/lib/api/content';
import { useRevisionEditor } from '@/lib/cms/revision-editor-context';
import { useT } from '@/lib/i18n/i18n-context';
import { Button, IconButton, useToast } from '@/components/ui';
import { ResourceView, EmptyState } from '@/components/ui/states';
import { useResource } from '@/lib/hooks/use-resource';
import { ActivityCard } from './ActivityCard';
import { AddActivityDialog, defaultPayloadFor } from './AddActivityDialog';
import { describeError } from '@/lib/ui/error-text';

function Sortable({ id, dragLabel, children }: { id: string; dragLabel: string; children: (handle: React.ReactNode) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  const handle = (
    <button ref={setNodeRef as unknown as React.Ref<HTMLButtonElement>} {...attributes} {...listeners} aria-label={dragLabel} className="cursor-grab touch-none text-muted hover:text-text">
      <FiMove aria-hidden />
    </button>
  );
  return (
    <div ref={setNodeRef} style={style}>
      {children(handle)}
    </div>
  );
}

export function ActivitiesEditor({ revisionId, subjectId, editable }: { revisionId: string; subjectId: string; editable: boolean }) {
  const { revision, setRevisionToken } = useRevisionEditor();
  const { toast } = useToast();
  const t = useT();
  const res = useResource(useCallback(() => listActivities(revisionId), [revisionId]), [revisionId]);
  const [items, setItems] = useState<Activity[]>([]);
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  useEffect(() => {
    if (res.data) setItems([...res.data].sort((a, b) => a.position - b.position));
  }, [res.data]);

  async function persistOrder(ordered: Activity[]) {
    const prev = items;
    setItems(ordered); // optimistic
    try {
      const r = await reorderActivities(revisionId, { expectedRevisionUpdatedAt: revision.updatedAt, orderedActivityIds: ordered.map((a) => a.id) });
      setRevisionToken(r.revisionUpdatedAt);
      toast(t('activity.reordered'), 'success');
      res.reload(); // adopt canonical positions from server
    } catch (e) {
      setItems(prev); // rollback optimistic order
      toast(describeError(e, t), 'error');
      res.reload(); // reload canonical server order (never leave a rejected optimistic order)
    }
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((a) => a.id === active.id);
    const newIndex = items.findIndex((a) => a.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    void persistOrder(arrayMove(items, oldIndex, newIndex));
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    void persistOrder(arrayMove(items, index, target));
  }

  async function onAdd(type: ActivityType) {
    setCreating(true);
    try {
      const r = await createActivity(revisionId, { expectedRevisionUpdatedAt: revision.updatedAt, type, position: items.length, payload: defaultPayloadFor(type) });
      setRevisionToken(r.revisionUpdatedAt);
      toast(t('activity.added'), 'success');
      setAdding(false);
      res.reload();
    } catch (e) {
      toast(describeError(e, t), 'error');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{t('activity.title')}</h3>
        {editable && (
          <Button size="sm" variant="secondary" leftIcon={<FiPlus aria-hidden />} onClick={() => setAdding(true)}>
            {t('activity.add')}
          </Button>
        )}
      </div>

      <ResourceView loading={res.loading} error={res.error} data={res.data} onRetry={res.reload} isEmpty={() => items.length === 0} empty={<EmptyState title={t('activity.emptyTitle')} message={t('activity.emptyBody')} />}>
        {() => (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={items.map((a) => a.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-3">
                {items.map((a, i) => (
                  <li key={a.id}>
                    {editable ? (
                      <Sortable id={a.id} dragLabel={t('activity.dragReorder')}>
                        {(handle) => (
                          <div className="relative">
                            <ActivityCard
                              activity={a}
                              subjectId={subjectId}
                              editable={editable}
                              handle={
                                <span className="flex items-center gap-1">
                                  {handle}
                                  <span className="flex flex-col">
                                    <IconButton label={t('activity.moveUp')} onClick={() => move(i, -1)} className="h-5 w-5">
                                      <FiChevronUp aria-hidden />
                                    </IconButton>
                                    <IconButton label={t('activity.moveDown')} onClick={() => move(i, 1)} className="h-5 w-5">
                                      <FiChevronDown aria-hidden />
                                    </IconButton>
                                  </span>
                                </span>
                              }
                              onDeleted={() => res.reload()}
                              onUpdated={(na) => setItems((cur) => cur.map((x) => (x.id === na.id ? na : x)))}
                            />
                          </div>
                        )}
                      </Sortable>
                    ) : (
                      <ActivityCard activity={a} subjectId={subjectId} editable={false} onDeleted={() => res.reload()} onUpdated={(na) => setItems((cur) => cur.map((x) => (x.id === na.id ? na : x)))} />
                    )}
                  </li>
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </ResourceView>

      <AddActivityDialog open={adding} onClose={() => setAdding(false)} onPick={onAdd} busy={creating} />
    </div>
  );
}
