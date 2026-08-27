'use client';

import { useState } from 'react';
import { FiSend, FiUploadCloud, FiCornerUpLeft } from 'react-icons/fi';
import {
  publishAssessmentVersion,
  returnAssessmentToDraft,
  submitAssessmentReview,
  type AssessmentVersionDetail,
  type AssessmentVersionStatus,
} from '@/lib/api/assessments';
import { useCapabilities } from '@/lib/cms/cms-context';
import { useT } from '@/lib/i18n/i18n-context';
import { Button, useToast } from '@/components/ui';
import { ConfirmDialog } from '@/components/ui/dialog';
import { describeError } from '@/lib/ui/error-text';

/**
 * Version lifecycle actions — DRAFT→REVIEW (author), REVIEW→DRAFT with reason / REVIEW→PUBLISHED (publish). Gated by
 * capability AND status; publish/return confirm via ConfirmDialog. Each transition returns the fresh version detail
 * (new OCC token) via onChanged; onWorkflowDone lets the parent reload the definition/version list (status +
 * currentVersion change on publish). The backend re-checks readiness and immutability — a failure is toasted.
 */
export function AssessmentWorkflowActions({
  version,
  onChanged,
  onWorkflowDone,
}: {
  version: { id: string; status: AssessmentVersionStatus; updatedAt: string };
  onChanged: (detail: AssessmentVersionDetail) => void;
  onWorkflowDone?: () => void;
}) {
  const caps = useCapabilities();
  const t = useT();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [publishConfirm, setPublishConfirm] = useState(false);
  const [returning, setReturning] = useState(false);

  async function run(fn: () => Promise<AssessmentVersionDetail>, successKey: string) {
    setBusy(true);
    try {
      const detail = await fn();
      onChanged(detail);
      onWorkflowDone?.();
      toast(t(successKey), 'success');
    } catch (e) {
      toast(describeError(e, t), 'error');
    } finally {
      setBusy(false);
      setPublishConfirm(false);
      setReturning(false);
    }
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-text">{t('assessmentBuilder.workflowTitle')}</h3>

      {version.status === 'DRAFT' && caps.author && (
        <Button
          className="w-full"
          leftIcon={<FiSend aria-hidden />}
          loading={busy}
          onClick={() => run(() => submitAssessmentReview(version.id, { expectedVersionUpdatedAt: version.updatedAt }), 'assessmentBuilder.submitted')}
        >
          {t('assessmentBuilder.submitReview')}
        </Button>
      )}

      {version.status === 'REVIEW' && caps.publish && (
        <div className="space-y-2">
          <Button className="w-full" leftIcon={<FiUploadCloud aria-hidden />} loading={busy} onClick={() => setPublishConfirm(true)}>
            {t('assessmentBuilder.publish')}
          </Button>
          <Button className="w-full" variant="secondary" leftIcon={<FiCornerUpLeft aria-hidden />} disabled={busy} onClick={() => setReturning(true)}>
            {t('assessmentBuilder.returnToDraft')}
          </Button>
        </div>
      )}
      {version.status === 'REVIEW' && !caps.publish && (
        <p className="rounded-control border border-border bg-surface-2 px-3 py-2 text-sm text-muted">{t('assessmentBuilder.noPublishRight')}</p>
      )}

      {version.status === 'PUBLISHED' && (
        <p className="rounded-control border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{t('assessmentBuilder.publishedReadonly')}</p>
      )}
      {version.status === 'ARCHIVED' && (
        <p className="rounded-control border border-border bg-surface-2 px-3 py-2 text-sm text-muted">{t('assessmentBuilder.archivedReadonly')}</p>
      )}

      <ConfirmDialog
        open={publishConfirm}
        onClose={() => setPublishConfirm(false)}
        onConfirm={() => run(() => publishAssessmentVersion(version.id, { expectedVersionUpdatedAt: version.updatedAt }), 'assessmentBuilder.publishedToast')}
        title={t('assessmentBuilder.publishConfirmTitle')}
        message={t('assessmentBuilder.publishConfirmBody')}
        confirmLabel={t('assessmentBuilder.publish')}
        busy={busy}
      />
      <ConfirmDialog
        open={returning}
        onClose={() => setReturning(false)}
        onConfirm={(reason) => run(() => returnAssessmentToDraft(version.id, { expectedVersionUpdatedAt: version.updatedAt, reason }), 'assessmentBuilder.returned')}
        title={t('assessmentBuilder.returnConfirmTitle')}
        message={t('assessmentBuilder.returnConfirmBody')}
        confirmLabel={t('assessmentBuilder.returnToDraft')}
        requireReason
        reasonLabel={t('common.reason')}
        busy={busy}
      />
    </div>
  );
}
