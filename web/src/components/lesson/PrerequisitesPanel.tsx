'use client';

import { useCallback, useState } from 'react';
import { FiPlus, FiX } from 'react-icons/fi';
import { listPrerequisites } from '@/lib/api/content';
import { useResource } from '@/lib/hooks/use-resource';
import { Button, useToast } from '@/components/ui';
import { StatusBadge } from '@/components/ui/status-badge';
import { ResourceView } from '@/components/ui/states';
import { PrerequisitePickerDialog } from './PrerequisitePickerDialog';
import { describeError } from '@/lib/ui/error-text';

/** Prerequisite list + add/remove. Token-agnostic: parent wires add/remove to Lesson.updatedAt aggregate token. */
export function PrerequisitesPanel({
  lessonId,
  subjectId,
  editable,
  reloadKey,
  onAdd,
  onRemove,
}: {
  lessonId: string;
  subjectId: string;
  editable: boolean;
  reloadKey: string;
  onAdd: (prerequisiteLessonId: string) => Promise<void>;
  onRemove: (prerequisiteLessonId: string) => Promise<void>;
}) {
  const { toast } = useToast();
  const res = useResource(useCallback(() => listPrerequisites(lessonId), [lessonId]), [lessonId, reloadKey]);
  const [picking, setPicking] = useState(false);

  async function remove(id: string) {
    try {
      await onRemove(id);
      res.reload();
    } catch (e) {
      toast(describeError(e), 'error');
      res.reload();
    }
  }

  const current = res.data ?? [];
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text">Talablar (prerequisites)</span>
        {editable && (
          <Button size="sm" variant="secondary" leftIcon={<FiPlus aria-hidden />} onClick={() => setPicking(true)}>
            Qo‘shish
          </Button>
        )}
      </div>
      <ResourceView loading={res.loading} error={res.error} data={res.data} onRetry={res.reload}>
        {(items) =>
          items.length === 0 ? (
            <p className="text-xs text-muted">Talab qo‘shilmagan.</p>
          ) : (
            <ul className="space-y-1.5">
              {items.map((p) => (
                <li key={p.prerequisiteLessonId} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-text">{p.contentKey}</span>
                    <StatusBadge status={p.status} />
                  </span>
                  {editable && (
                    <button type="button" aria-label={`${p.contentKey} talabini olib tashlash`} onClick={() => remove(p.prerequisiteLessonId)} className="text-muted hover:text-danger">
                      <FiX aria-hidden />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )
        }
      </ResourceView>

      <PrerequisitePickerDialog
        open={picking}
        subjectId={subjectId}
        selfLessonId={lessonId}
        excludeIds={current.map((p) => p.prerequisiteLessonId)}
        onPick={async (prereqId) => {
          await onAdd(prereqId);
          res.reload();
        }}
        onClose={() => setPicking(false)}
      />
    </div>
  );
}
