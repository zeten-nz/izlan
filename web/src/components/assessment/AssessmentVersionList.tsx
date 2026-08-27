'use client';

import { useState } from 'react';
import { FiPlus } from 'react-icons/fi';
import {
  createAssessmentVersion,
  type AssessmentDefinitionView,
  type AssessmentVersionDetail,
  type AssessmentVersionSummary,
} from '@/lib/api/assessments';
import { useCapabilities } from '@/lib/cms/cms-context';
import { useT } from '@/lib/i18n/i18n-context';
import { Button, Card, useToast } from '@/components/ui';
import { StatusBadge } from '@/components/ui/status-badge';
import { describeError } from '@/lib/ui/error-text';

/**
 * Version history + create actions. Only ONE editable (DRAFT/REVIEW) version may exist — when one does, creation is
 * disabled with an explanation (backend also rejects). clone_current needs a published current version.
 */
export function AssessmentVersionList({
  definition,
  versions,
  selectedVersionId,
  onSelect,
  onCreated,
}: {
  definition: AssessmentDefinitionView;
  versions: AssessmentVersionSummary[];
  selectedVersionId: string | null;
  onSelect: (id: string) => void;
  onCreated: (detail: AssessmentVersionDetail) => void;
}) {
  const t = useT();
  const caps = useCapabilities();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const hasEditable = versions.some((v) => v.status === 'DRAFT' || v.status === 'REVIEW');
  const canClone = !!definition.currentVersionId;

  async function create(mode: 'blank' | 'clone_current') {
    setBusy(true);
    try {
      const detail = await createAssessmentVersion(definition.id, { mode });
      onCreated(detail);
      toast(t('assessmentBuilder.versionCreated'), 'success');
    } catch (e) {
      toast(describeError(e, t), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <h3 className="text-sm font-semibold text-text">{t('assessmentBuilder.versionsTitle')}</h3>
      {versions.length === 0 ? (
        <p className="text-sm text-muted">{t('assessmentBuilder.selectVersion')}</p>
      ) : (
        <ul className="space-y-1.5">
          {versions.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => onSelect(v.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-control border px-3 py-2 text-left text-sm transition-colors ${
                  selectedVersionId === v.id ? 'border-primary bg-primary-tint' : 'border-border bg-surface hover:bg-surface-2'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="font-medium text-text">{t('assessmentBuilder.versionLabel', { n: String(v.versionNo) })}</span>
                  <StatusBadge status={v.status} />
                  {v.isCurrent && <span className="text-xs text-success">• {t('assessmentBuilder.current')}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted">{t('assessmentBuilder.itemsCount', { n: String(v.itemCount) })}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {caps.author && (
        <div className="space-y-2 border-t border-border pt-3">
          {hasEditable ? (
            <p className="text-xs text-muted">{t('assessmentBuilder.editableExists')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" leftIcon={<FiPlus aria-hidden />} loading={busy} onClick={() => create('blank')}>
                {t('assessmentBuilder.newBlank')}
              </Button>
              <Button
                size="sm"
                leftIcon={<FiPlus aria-hidden />}
                loading={busy}
                disabled={!canClone}
                title={!canClone ? t('assessmentBuilder.noCurrentToClone') : undefined}
                onClick={() => create('clone_current')}
              >
                {t('assessmentBuilder.newClone')}
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
