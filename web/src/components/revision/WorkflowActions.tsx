'use client';

import { useCallback, useState } from 'react';
import { FiSend, FiUploadCloud, FiCornerUpLeft, FiCheckCircle } from 'react-icons/fi';
import { getLesson, getReadiness, publishRevision, returnToDraft, submitReview } from '@/lib/api/content';
import { useResource } from '@/lib/hooks/use-resource';
import { useRevisionEditor } from '@/lib/cms/revision-editor-context';
import { useCapabilities } from '@/lib/cms/cms-context';
import { useT } from '@/lib/i18n/i18n-context';
import { Button, useToast } from '@/components/ui';
import { ConfirmDialog } from '@/components/ui/dialog';
import { describeError } from '@/lib/ui/error-text';

export function WorkflowActions({ onReload }: { onReload?: () => void }) {
  const { revision, setRevision } = useRevisionEditor();
  const caps = useCapabilities();
  const t = useT();
  const { toast } = useToast();
  const lessonRes = useResource(useCallback(() => getLesson(revision.lessonId), [revision.lessonId]), [revision.lessonId, revision.updatedAt]);
  const [busy, setBusy] = useState(false);
  const [returning, setReturning] = useState(false);
  const [publishConfirm, setPublishConfirm] = useState(false);
  const [freshLessonToken, setFreshLessonToken] = useState<string | null>(null);

  const status = revision.status;
  const isCurrent = lessonRes.data?.publishedRevisionId === revision.id && status === 'PUBLISHED';
  const willReplace = !!lessonRes.data?.publishedRevisionId && lessonRes.data?.publishedRevisionId !== revision.id;

  async function onSubmit() {
    setBusy(true);
    try {
      const readiness = await getReadiness(revision.id); // §38 refresh before transition
      if (!readiness.reviewReady) {
        toast(t('workflow.notReadyReview'), 'error');
        return;
      }
      const updated = await submitReview(revision.id, { expectedUpdatedAt: revision.updatedAt });
      setRevision(updated);
      toast(t('workflow.submitted'), 'success');
    } catch (e) {
      toast(describeError(e, t), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function beginPublish() {
    setBusy(true);
    try {
      const readiness = await getReadiness(revision.id); // §40 refresh readiness
      if (!readiness.publishReady) {
        toast(t('workflow.notReadyPublish'), 'error');
        return;
      }
      const freshLesson = await getLesson(revision.lessonId); // §40 fresh Lesson token
      setFreshLessonToken(freshLesson.updatedAt);
      setPublishConfirm(true);
    } catch (e) {
      toast(describeError(e, t), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function confirmPublish() {
    if (!freshLessonToken) return;
    setBusy(true);
    try {
      const view = await publishRevision(revision.id, { expectedRevisionUpdatedAt: revision.updatedAt, expectedLessonUpdatedAt: freshLessonToken });
      setRevision(view.revision);
      toast(t('workflow.published'), 'success');
      lessonRes.reload();
      onReload?.();
    } catch (e) {
      toast(describeError(e, t), 'error');
    } finally {
      setBusy(false);
      setPublishConfirm(false);
      setFreshLessonToken(null);
    }
  }

  async function onReturn(reason: string) {
    setBusy(true);
    try {
      const updated = await returnToDraft(revision.id, { expectedUpdatedAt: revision.updatedAt, reason });
      setRevision(updated);
      toast(t('workflow.returned'), 'success');
    } catch (e) {
      toast(describeError(e, t), 'error');
    } finally {
      setBusy(false);
      setReturning(false);
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-text">{t('workflow.title')}</h3>

      {status === 'DRAFT' && caps.author && (
        <Button className="w-full" leftIcon={<FiSend aria-hidden />} loading={busy} onClick={onSubmit}>
          {t('workflow.submitReview')}
        </Button>
      )}

      {status === 'REVIEW' && caps.publish && (
        <div className="space-y-2">
          <Button className="w-full" leftIcon={<FiUploadCloud aria-hidden />} loading={busy} onClick={beginPublish}>
            {t('workflow.publish')}
          </Button>
          <Button className="w-full" variant="secondary" leftIcon={<FiCornerUpLeft aria-hidden />} disabled={busy} onClick={() => setReturning(true)}>
            {t('workflow.returnToDraft')}
          </Button>
        </div>
      )}
      {status === 'REVIEW' && !caps.publish && <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted">{t('workflow.noPublishRight')}</p>}

      {status === 'PUBLISHED' &&
        (isCurrent ? (
          <p className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
            <FiCheckCircle aria-hidden /> {t('workflow.currentPublished')}
          </p>
        ) : (
          <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted">{t('workflow.publishedNotCurrent')}</p>
        ))}

      {status === 'ARCHIVED' && <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted">{t('workflow.archivedReadonly')}</p>}

      <ConfirmDialog
        open={publishConfirm}
        onClose={() => {
          setPublishConfirm(false);
          setFreshLessonToken(null);
        }}
        onConfirm={confirmPublish}
        title={t('workflow.publishTitle')}
        message={
          <span className="block space-y-1">
            <span className="block">
              {t('workflow.publishLesson')}: <strong>{lessonRes.data?.contentKey ?? '—'}</strong>
            </span>
            <span className="block">
              {t('workflow.publishVersion')}: <strong>v{revision.version}</strong>
            </span>
            <span className="block">
              {t('workflow.publishReadyLabel')}: <strong>{t('workflow.publishReadyValue')}</strong>
            </span>
            {willReplace && <span className="mt-2 block rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">{t('workflow.publishReplaceNote')}</span>}
          </span>
        }
        confirmLabel={t('workflow.publish')}
        busy={busy}
      />

      <ConfirmDialog
        open={returning}
        onClose={() => setReturning(false)}
        onConfirm={onReturn}
        title={t('workflow.returnTitle')}
        message={t('workflow.returnBody')}
        confirmLabel={t('workflow.returnToDraft')}
        requireReason
        reasonLabel={t('common.reason')}
        busy={busy}
      />
    </div>
  );
}
