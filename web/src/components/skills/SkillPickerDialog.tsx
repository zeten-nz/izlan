'use client';

import { useCallback, useMemo, useState } from 'react';
import { listSkills } from '@/lib/api/content';
import { useResource } from '@/lib/hooks/use-resource';
import { Dialog } from '@/components/ui/dialog';
import { Button, Input } from '@/components/ui';
import { EmptyState, ResourceView } from '@/components/ui/states';
import { describeError } from '@/lib/ui/error-text';
import { useToast } from '@/components/ui';

/** Pick ONE ACTIVE same-Subject skill not already mapped. Backend enforces same-subject/active/idempotency. */
export function SkillPickerDialog({
  open,
  subjectId,
  excludeIds,
  onPick,
  onClose,
}: {
  open: boolean;
  subjectId: string;
  excludeIds: string[];
  onPick: (skillId: string) => Promise<void>;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const res = useResource(useCallback(() => listSkills(subjectId), [subjectId]), [subjectId, open]);
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const exclude = useMemo(() => new Set(excludeIds), [excludeIds]);

  async function pick(id: string) {
    setBusyId(id);
    try {
      await onPick(id);
      toast('Biriktirildi', 'success');
      onClose();
    } catch (e) {
      toast(describeError(e), 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Ko‘nikma biriktirish">
      <div className="space-y-3">
        <Input placeholder="Qidirish…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Ko‘nikma qidirish" />
        <ResourceView loading={res.loading} error={res.error} data={res.data} onRetry={res.reload}>
          {(skills) => {
            const candidates = skills.filter(
              (s) => s.status === 'ACTIVE' && !exclude.has(s.id) && (q.trim() === '' || s.name.toLowerCase().includes(q.trim().toLowerCase())),
            );
            if (candidates.length === 0) return <EmptyState title="Mos ko‘nikma yo‘q" message="Barcha faol ko‘nikmalar biriktirilgan yoki mavjud emas." />;
            return (
              <ul className="max-h-72 space-y-1 overflow-y-auto">
                {candidates.map((s) => (
                  <li key={s.id}>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full justify-between"
                      loading={busyId === s.id}
                      onClick={() => pick(s.id)}
                    >
                      <span className="truncate">{s.name}</span>
                      {s.code && <span className="text-xs text-muted">{s.code}</span>}
                    </Button>
                  </li>
                ))}
              </ul>
            );
          }}
        </ResourceView>
      </div>
    </Dialog>
  );
}
