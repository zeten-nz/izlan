'use client';

import { useCallback, useMemo, useState } from 'react';
import { collectSubjectLessons } from '@/lib/api/hierarchy-helpers';
import { useResource } from '@/lib/hooks/use-resource';
import { Dialog } from '@/components/ui/dialog';
import { Button, Input, useToast } from '@/components/ui';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState, ResourceView } from '@/components/ui/states';
import { describeError } from '@/lib/ui/error-text';
import { useT } from '@/lib/i18n/i18n-context';

/**
 * Pick a same-Subject prerequisite lesson. Candidates come from walking the Subject hierarchy (existing reads only).
 * Self and ARCHIVED targets are not selectable; already-added targets are excluded. Backend remains the DAG authority
 * (cycles/same-subject re-checked server-side).
 */
export function PrerequisitePickerDialog({
  open,
  subjectId,
  selfLessonId,
  excludeIds,
  onPick,
  onClose,
}: {
  open: boolean;
  subjectId: string;
  selfLessonId: string;
  excludeIds: string[];
  onPick: (lessonId: string) => Promise<void>;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const t = useT();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const res = useResource(useCallback(() => collectSubjectLessons(subjectId), [subjectId]), [subjectId, open]);
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const exclude = useMemo(() => new Set([...excludeIds, selfLessonId]), [excludeIds, selfLessonId]);

  async function pick(id: string) {
    setBusyId(id);
    try {
      await onPick(id);
      toast(t('prereq.added'), 'success');
      onClose();
    } catch (e) {
      toast(describeError(e, t), 'error'); // e.g. CONTENT_PREREQUISITE_CYCLE
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('prereq.pickTitle')}>
      <div className="space-y-3">
        <Input placeholder={t('prereq.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('prereq.searchLessons')} />
        <ResourceView loading={res.loading} error={res.error} data={res.data} onRetry={res.reload}>
          {(lessons) => {
            const candidates = lessons.filter(
              (l) =>
                !exclude.has(l.id) &&
                l.status !== 'ARCHIVED' && // archived targets are not valid prerequisites
                (q.trim() === '' || l.contentKey.toLowerCase().includes(q.trim().toLowerCase())),
            );
            if (candidates.length === 0) return <EmptyState title={t('prereq.noCandidates')} message={t('prereq.noCandidatesBody')} />;
            return (
              <ul className="max-h-72 space-y-1 overflow-y-auto">
                {candidates.map((l) => (
                  <li key={l.id}>
                    <Button variant="secondary" size="sm" className="w-full justify-between" loading={busyId === l.id} onClick={() => pick(l.id)}>
                      <span className="truncate">{l.contentKey}</span>
                      <StatusBadge status={l.status} />
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
