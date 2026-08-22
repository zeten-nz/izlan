'use client';

import { useState, type ReactNode } from 'react';
import { FiTrash2 } from 'react-icons/fi';
import type { Activity } from '@/lib/api/types';
import { activityCategory, activityTypeLabelKey } from '@/lib/activity/activity-meta';
import { useT } from '@/lib/i18n/i18n-context';
import {
  addActivitySkill,
  deleteActivity,
  listActivitySkills,
  removeActivitySkill,
  updateActivity,
} from '@/lib/api/content';
import { useRevisionEditor } from '@/lib/cms/revision-editor-context';
import { Card, IconButton, useToast } from '@/components/ui';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/status-badge';
import { MappedSkillsPanel } from '@/components/skills/MappedSkillsPanel';
import { MarkdownActivityEditor } from './MarkdownActivityEditor';
import { ObjectiveActivityEditor } from './ObjectiveActivityEditor';
import { describeError } from '@/lib/ui/error-text';

export function ActivityCard({
  activity,
  subjectId,
  editable,
  handle,
  onDeleted,
  onUpdated,
}: {
  activity: Activity;
  subjectId: string;
  editable: boolean;
  handle?: ReactNode;
  onDeleted: (id: string) => void;
  onUpdated: (a: Activity) => void;
}) {
  const { revision, setRevisionToken } = useRevisionEditor();
  const { toast } = useToast();
  const t = useT();
  const [committing, setCommitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const category = activityCategory(activity.type);

  async function commit(payload: unknown, durationMin: number | undefined) {
    setCommitting(true);
    try {
      const r = await updateActivity(activity.id, { expectedRevisionUpdatedAt: revision.updatedAt, payload, estimatedDurationMin: durationMin });
      setRevisionToken(r.revisionUpdatedAt);
      onUpdated(r.activity);
      toast(t('common.saved'), 'success');
    } catch (e) {
      toast(describeError(e, t), 'error');
    } finally {
      setCommitting(false);
    }
  }

  async function doDelete() {
    setDeleting(true);
    try {
      const r = await deleteActivity(activity.id, { expectedRevisionUpdatedAt: revision.updatedAt });
      setRevisionToken(r.revisionUpdatedAt);
      onDeleted(activity.id);
      toast(t('activity.deleted'), 'success');
    } catch (e) {
      toast(describeError(e, t), 'error');
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const md = ((activity.payload ?? {}) as Record<string, unknown>).markdown;
  const initialMarkdown = typeof md === 'string' ? md : '';

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {handle}
          <span className="grid h-6 w-6 place-items-center rounded bg-surface-2 text-xs font-semibold text-muted">{activity.position + 1}</span>
          <span className="text-sm font-semibold text-text">{t(activityTypeLabelKey(activity.type))}</span>
          <Badge>{activity.type}</Badge>
        </div>
        {editable && (
          <IconButton label={t('activity.deleteTitle')} variant="danger" onClick={() => setConfirmDelete(true)}>
            <FiTrash2 aria-hidden />
          </IconButton>
        )}
      </div>

      {category === 'markdown' && (
        <MarkdownActivityEditor initialMarkdown={initialMarkdown} initialDuration={activity.estimatedDurationMin} editable={editable} committing={committing} onCommit={commit} />
      )}
      {category === 'objective' && (
        <ObjectiveActivityEditor initialPayload={activity.payload} initialDuration={activity.estimatedDurationMin} editable={editable} committing={committing} onCommit={commit} />
      )}
      {category === 'media' && <div className="rounded-lg border border-dashed border-border bg-surface-2 px-3 py-4 text-sm text-muted">{t('activity.mediaNote', { type: activity.type })}</div>}
      {category === 'unsupported' && <div className="rounded-lg border border-dashed border-danger/40 bg-danger/5 px-3 py-4 text-sm text-danger">{t('activity.unsupportedNote', { type: activity.type })}</div>}

      {subjectId && (category === 'markdown' || category === 'objective') && (
        <div className="mt-3 border-t border-border pt-3">
          <MappedSkillsPanel
            label={t('activity.skillsLabel')}
            subjectId={subjectId}
            editable={editable}
            reloadKey={`as:${activity.id}:${revision.updatedAt}`}
            loadMapped={() => listActivitySkills(activity.id)}
            onAdd={async (skillId) => {
              const r = await addActivitySkill(activity.id, { expectedRevisionUpdatedAt: revision.updatedAt, skillId });
              setRevisionToken(r.revisionUpdatedAt);
            }}
            onRemove={async (skillId) => {
              const r = await removeActivitySkill(activity.id, skillId, { expectedRevisionUpdatedAt: revision.updatedAt });
              setRevisionToken(r.revisionUpdatedAt);
            }}
          />
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={doDelete}
        title={t('activity.deleteTitle')}
        message={t('activity.deleteBody')}
        confirmLabel={t('common.delete')}
        danger
        busy={deleting}
      />
    </Card>
  );
}
