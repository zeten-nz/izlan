'use client';

import { useCallback, useMemo, useState } from 'react';
import { listSkills } from '@/lib/api/content';
import { useResource } from '@/lib/hooks/use-resource';
import { Dialog } from '@/components/ui/dialog';
import { Button, Input } from '@/components/ui';
import { EmptyState, ResourceView } from '@/components/ui/states';
import { describeError } from '@/lib/ui/error-text';
import { useToast } from '@/components/ui';
import { useT } from '@/lib/i18n/i18n-context';

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
  const t = useT();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const res = useResource(useCallback(() => listSkills(subjectId), [subjectId]), [subjectId, open]);
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const exclude = useMemo(() => new Set(excludeIds), [excludeIds]);

  async function pick(id: string) {
    setBusyId(id);
    try {
      await onPick(id);
      toast(t('skill.mapped'), 'success');
      onClose();
    } catch (e) {
      toast(describeError(e, t), 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('skill.mapTitle')}>
      <div className="space-y-3">
        <Input placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('skill.title')} />
        <ResourceView loading={res.loading} error={res.error} data={res.data} onRetry={res.reload}>
          {(skills) => {
            const candidates = skills.filter(
              (sk) => sk.status === 'ACTIVE' && !exclude.has(sk.id) && (q.trim() === '' || sk.name.toLowerCase().includes(q.trim().toLowerCase())),
            );
            if (candidates.length === 0) return <EmptyState title={t('skill.noCandidates')} message={t('skill.noCandidatesBody')} />;
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
