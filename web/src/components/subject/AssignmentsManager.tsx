'use client';

import { useCallback, useState } from 'react';
import { FiPlus, FiTrash2, FiUser } from 'react-icons/fi';
import { assignUser, listAssignments, removeAssignment } from '@/lib/api/content';
import type { Assignment } from '@/lib/api/types';
import { useResource } from '@/lib/hooks/use-resource';
import { Button, Card, IconButton, Input, useToast } from '@/components/ui';
import { ConfirmDialog } from '@/components/ui/dialog';
import { ResourceView, EmptyState } from '@/components/ui/states';
import { describeError } from '@/lib/ui/error-text';
import { formatDateTime } from '@/lib/ui/format';

/** Subject assignment management (content.subject.manage only). MVP: add by userId, remove with confirm. */
export function AssignmentsManager({ subjectId }: { subjectId: string }) {
  const { toast } = useToast();
  const res = useResource(useCallback(() => listAssignments(subjectId), [subjectId]), [subjectId]);
  const [userId, setUserId] = useState('');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Assignment | null>(null);
  const [busy, setBusy] = useState(false);

  async function onAdd() {
    setAdding(true);
    try {
      await assignUser(subjectId, userId.trim());
      toast('Biriktirildi', 'success');
      setUserId('');
      res.reload();
    } catch (e) {
      toast(describeError(e), 'error');
    } finally {
      setAdding(false);
    }
  }

  async function onRemove(a: Assignment) {
    setBusy(true);
    try {
      await removeAssignment(subjectId, a.userId);
      toast('Olib tashlandi', 'success');
      res.reload();
    } catch (e) {
      toast(describeError(e), 'error');
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Biriktirmalar</h3>
      <div className="flex gap-2">
        <Input placeholder="Foydalanuvchi ID (UUID)" value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Foydalanuvchi ID" />
        <Button leftIcon={<FiPlus aria-hidden />} onClick={onAdd} loading={adding} disabled={userId.trim().length === 0}>
          Qo‘shish
        </Button>
      </div>

      <ResourceView
        loading={res.loading}
        error={res.error}
        data={res.data}
        onRetry={res.reload}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title="Biriktirma yo‘q" message="Bu fanga hali hech kim biriktirilmagan." />}
      >
        {(items) => (
          <ul className="space-y-2">
            {items.map((a) => (
              <li key={a.id}>
                <Card className="flex items-center justify-between gap-2 p-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <FiUser className="text-muted" aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs text-text">{a.userId}</p>
                      <p className="text-xs text-muted">{formatDateTime(a.assignedAt)}</p>
                    </div>
                  </div>
                  <IconButton label="Olib tashlash" variant="danger" onClick={() => setRemoving(a)}>
                    <FiTrash2 aria-hidden />
                  </IconButton>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </ResourceView>

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && onRemove(removing)}
        title="Biriktirmani olib tashlash"
        message={`Foydalanuvchi ${removing?.userId ?? ''} ushbu fandan olib tashlansinmi?`}
        confirmLabel="Olib tashlash"
        danger
        busy={busy}
      />
    </div>
  );
}
