'use client';

import { useCallback, useState } from 'react';
import { FiPlus, FiX } from 'react-icons/fi';
import type { MappedSkill } from '@/lib/api/types';
import { useResource } from '@/lib/hooks/use-resource';
import { Button, useToast } from '@/components/ui';
import { Badge } from '@/components/ui/status-badge';
import { ResourceView } from '@/components/ui/states';
import { SkillPickerDialog } from './SkillPickerDialog';
import { describeError } from '@/lib/ui/error-text';
import { useT } from '@/lib/i18n/i18n-context';

/**
 * Generic mapped-skill list + add/remove. The parent injects list/add/remove wired to the correct OCC aggregate
 * token (Lesson.updatedAt for LessonSkill, Revision.updatedAt for ActivitySkill) so this panel stays token-agnostic.
 */
export function MappedSkillsPanel({
  label,
  subjectId,
  editable,
  reloadKey,
  loadMapped,
  onAdd,
  onRemove,
}: {
  label: string;
  subjectId: string;
  editable: boolean;
  reloadKey: string;
  loadMapped: () => Promise<MappedSkill[]>;
  onAdd: (skillId: string) => Promise<void>;
  onRemove: (skillId: string) => Promise<void>;
}) {
  const { toast } = useToast();
  const t = useT();
  // Intentionally key the refetch on reloadKey only (loadMapped is a fresh closure each render).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const res = useResource(useCallback(() => loadMapped(), [reloadKey]), [reloadKey]);
  const [picking, setPicking] = useState(false);

  async function remove(skillId: string) {
    try {
      await onRemove(skillId);
      res.reload();
    } catch (e) {
      toast(describeError(e, t), 'error');
      res.reload();
    }
  }

  const mapped = res.data ?? [];
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text">{label}</span>
        {editable && (
          <Button size="sm" variant="secondary" leftIcon={<FiPlus aria-hidden />} onClick={() => setPicking(true)}>
            {t('skill.mapAdd')}
          </Button>
        )}
      </div>
      <ResourceView loading={res.loading} error={res.error} data={res.data} onRetry={res.reload}>
        {(skills) =>
          skills.length === 0 ? (
            <p className="text-xs text-muted">{t('skill.noMapped')}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {skills.map((sk) => (
                <li key={sk.skillId}>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs text-text">
                    {sk.name}
                    {sk.status === 'ARCHIVED' && <Badge tone="danger">{t('skill.archivedTag')}</Badge>}
                    {editable && (
                      <button type="button" aria-label={t('skill.removeMapped', { name: sk.name })} onClick={() => remove(sk.skillId)} className="text-muted transition-colors hover:text-danger">
                        <FiX aria-hidden />
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )
        }
      </ResourceView>

      <SkillPickerDialog
        open={picking}
        subjectId={subjectId}
        excludeIds={mapped.map((m) => m.skillId)}
        onPick={async (skillId) => {
          await onAdd(skillId);
          res.reload();
        }}
        onClose={() => setPicking(false)}
      />
    </div>
  );
}
