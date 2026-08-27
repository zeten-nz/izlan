'use client';

import { useEffect, useState } from 'react';
import { updateAssessmentConfig, type AssessmentConfigView, type AssessmentVersionDetail } from '@/lib/api/assessments';
import { useT } from '@/lib/i18n/i18n-context';
import { Button, Card, Field, Input, useToast } from '@/components/ui';
import { describeError } from '@/lib/ui/error-text';

/**
 * Structured Placement config — only the Methodist-editable fields (itemsPerSkill / maxItems / startDifficulty) are
 * inputs; the system fields (stepUp/stepDown/scale) are shown read-only. Never a raw JSON blob. Save is DRAFT-only,
 * OCC-guarded on the version token; the server preserves the system fields and re-validates.
 */
export function AssessmentConfigForm({
  config,
  versionId,
  versionUpdatedAt,
  editable,
  onChanged,
}: {
  config: AssessmentConfigView;
  versionId: string;
  versionUpdatedAt: string;
  editable: boolean;
  onChanged: (detail: AssessmentVersionDetail) => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const [itemsPerSkill, setItemsPerSkill] = useState(config.itemsPerSkill);
  const [maxItems, setMaxItems] = useState(config.maxItems);
  const [startDifficulty, setStartDifficulty] = useState(config.startDifficulty);
  const [busy, setBusy] = useState(false);

  // Re-sync when the server returns a fresh config (after save or version switch).
  useEffect(() => {
    setItemsPerSkill(config.itemsPerSkill);
    setMaxItems(config.maxItems);
    setStartDifficulty(config.startDifficulty);
  }, [config.itemsPerSkill, config.maxItems, config.startDifficulty]);

  const dirty = itemsPerSkill !== config.itemsPerSkill || maxItems !== config.maxItems || startDifficulty !== config.startDifficulty;

  async function save() {
    setBusy(true);
    try {
      const detail = await updateAssessmentConfig(versionId, { expectedVersionUpdatedAt: versionUpdatedAt, itemsPerSkill, maxItems, startDifficulty });
      onChanged(detail);
      toast(t('assessmentBuilder.configSaved'), 'success');
    } catch (e) {
      toast(describeError(e, t), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <h3 className="text-sm font-semibold text-text">{t('assessmentBuilder.configTitle')}</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('assessmentBuilder.itemsPerSkill')}>
          <Input type="number" min={1} value={itemsPerSkill} disabled={!editable || busy} onChange={(e) => setItemsPerSkill(Number(e.target.value))} />
        </Field>
        <Field label={t('assessmentBuilder.maxItems')}>
          <Input type="number" min={1} value={maxItems} disabled={!editable || busy} onChange={(e) => setMaxItems(Number(e.target.value))} />
        </Field>
        <Field label={t('assessmentBuilder.startDifficulty')} hint={`${config.system.minDifficulty}–${config.system.maxDifficulty}`}>
          <Input
            type="number"
            min={config.system.minDifficulty}
            max={config.system.maxDifficulty}
            value={startDifficulty}
            disabled={!editable || busy}
            onChange={(e) => setStartDifficulty(Number(e.target.value))}
          />
        </Field>
      </div>
      <p className="rounded-control border border-border bg-surface-2 px-3 py-2 text-xs text-muted">
        <span className="font-medium">{t('assessmentBuilder.systemFields')}:</span> {t('assessmentBuilder.stepUp')} {config.system.stepUp} · {t('assessmentBuilder.stepDown')}{' '}
        {config.system.stepDown} · {t('assessmentBuilder.difficultyScale')} {config.system.minDifficulty}–{config.system.maxDifficulty}
      </p>
      {editable && (
        <Button size="sm" loading={busy} disabled={!dirty} onClick={save}>
          {t('assessmentBuilder.saveConfig')}
        </Button>
      )}
    </Card>
  );
}
