'use client';

import { useCallback, useState } from 'react';
import {
  deleteAssessmentItem,
  getAssessmentVersion,
  reorderAssessmentItems,
  type AssessmentVersionDetail,
  type StaffAssessmentItem,
} from '@/lib/api/assessments';
import { listSkills } from '@/lib/api/content';
import { useCapabilities } from '@/lib/cms/cms-context';
import { useResource } from '@/lib/hooks/use-resource';
import { useT } from '@/lib/i18n/i18n-context';
import { ErrorState, LoadingRows, useToast } from '@/components/ui';
import { ConfirmDialog } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/ui/status-badge';
import { describeError } from '@/lib/ui/error-text';
import { AssessmentConfigForm } from './AssessmentConfigForm';
import { AssessmentPreview } from './AssessmentPreview';
import { AssessmentQuestionEditor } from './AssessmentQuestionEditor';
import { AssessmentQuestionList } from './AssessmentQuestionList';
import { AssessmentReadinessPanel } from './AssessmentReadinessPanel';
import { AssessmentWorkflowActions } from './AssessmentWorkflowActions';

/**
 * One version's editor. Holds the version detail (every mutation returns a fresh one, carrying the version's OCC token
 * and each item's token — replaced wholesale, so no stale-token bugs). Editable only when caps.author && status DRAFT.
 * readiness/preview refetch off `reloadKey` = version.updatedAt (advances after any edit). Workflow transitions bubble
 * up via onWorkflowDone so the parent reloads the definition/version list (status + currentVersion change on publish).
 */
export function AssessmentVersionWorkspace({ versionId, subjectId, onWorkflowDone }: { versionId: string; subjectId: string; onWorkflowDone?: () => void }) {
  const t = useT();
  const caps = useCapabilities();
  const { toast } = useToast();
  const verRes = useResource(useCallback(() => getAssessmentVersion(versionId), [versionId]), [versionId]);
  const skillsRes = useResource(useCallback(() => listSkills(subjectId), [subjectId]), [subjectId]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<StaffAssessmentItem | undefined>(undefined);
  const [deleting, setDeleting] = useState<StaffAssessmentItem | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  if (verRes.loading && !verRes.data) return <LoadingRows rows={4} />;
  if (verRes.error && !verRes.data) return <ErrorState error={verRes.error} onRetry={verRes.reload} />;
  const detail = verRes.data;
  if (!detail) return <ErrorState error={verRes.error} onRetry={verRes.reload} />;

  const skills = skillsRes.data ?? [];
  const editable = caps.author && detail.version.status === 'DRAFT';
  const setDetail = (d: AssessmentVersionDetail) => verRes.setData(() => d);
  const reloadKey = `${detail.version.id}:${detail.version.updatedAt}`;

  async function move(index: number, dir: -1 | 1) {
    const d = verRes.data;
    if (!d) return;
    const ids = d.items.map((i) => i.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    const tmp = ids[index]!;
    ids[index] = ids[j]!;
    ids[j] = tmp;
    setBusy(true);
    try {
      const next = await reorderAssessmentItems(d.version.id, { expectedVersionUpdatedAt: d.version.updatedAt, orderedItemIds: ids });
      setDetail(next);
      toast(t('assessmentBuilder.itemsReordered'), 'success');
    } catch (e) {
      toast(describeError(e, t), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      const d = await deleteAssessmentItem(deleting.id, { expectedItemUpdatedAt: deleting.updatedAt });
      setDetail(d);
      toast(t('assessmentBuilder.questionDeleted'), 'success');
    } catch (e) {
      toast(describeError(e, t), 'error');
    } finally {
      setBusy(false);
      setDeleting(undefined);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-text">{t('assessmentBuilder.versionLabel', { n: String(detail.version.versionNo) })}</span>
          <StatusBadge status={detail.version.status} />
          {detail.version.isCurrent && <span className="text-xs text-success">• {t('assessmentBuilder.current')}</span>}
        </div>

        <AssessmentConfigForm config={detail.config} versionId={detail.version.id} versionUpdatedAt={detail.version.updatedAt} editable={editable} onChanged={setDetail} />

        <AssessmentQuestionList
          items={detail.items}
          skills={skills}
          editable={editable}
          onAdd={() => {
            setEditing(undefined);
            setEditorOpen(true);
          }}
          onEdit={(item) => {
            setEditing(item);
            setEditorOpen(true);
          }}
          onDelete={(item) => setDeleting(item)}
          onMove={move}
        />

        <AssessmentPreview versionId={detail.version.id} reloadKey={reloadKey} />
      </div>

      <div className="space-y-4">
        <AssessmentReadinessPanel versionId={detail.version.id} reloadKey={reloadKey} skills={skills} />
        <AssessmentWorkflowActions version={detail.version} onChanged={setDetail} onWorkflowDone={onWorkflowDone} />
      </div>

      <AssessmentQuestionEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        versionId={detail.version.id}
        versionUpdatedAt={detail.version.updatedAt}
        item={editing}
        skills={skills}
        config={detail.config}
        onSaved={setDetail}
      />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(undefined)}
        onConfirm={confirmDelete}
        title={t('assessmentBuilder.deleteQuestion')}
        message={t('assessmentBuilder.deleteQuestionConfirm')}
        confirmLabel={t('assessmentBuilder.deleteQuestion')}
        danger
        busy={busy}
      />
    </div>
  );
}
