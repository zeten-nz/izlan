'use client';

import { useEffect, useState } from 'react';
import { updateAssessmentDefinition, type AssessmentDefinitionView } from '@/lib/api/assessments';
import { useT } from '@/lib/i18n/i18n-context';
import { Button, Field, Input, Textarea, useToast } from '@/components/ui';
import { Dialog } from '@/components/ui/dialog';
import { describeError } from '@/lib/ui/error-text';

/** Edit the definition's title/description (subject + purpose are immutable through the API). OCC on definition.updatedAt. */
export function AssessmentDefinitionEditor({
  open,
  onClose,
  definition,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  definition: AssessmentDefinitionView;
  onSaved: (def: AssessmentDefinitionView) => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const [title, setTitle] = useState(definition.title);
  const [description, setDescription] = useState(definition.description ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(definition.title);
      setDescription(definition.description ?? '');
    }
  }, [open, definition.title, definition.description]);

  async function save() {
    setBusy(true);
    try {
      const def = await updateAssessmentDefinition(definition.id, { expectedUpdatedAt: definition.updatedAt, title: title.trim(), description: description.trim() });
      onSaved(def);
      toast(t('assessmentBuilder.definitionUpdated'), 'success');
      onClose();
    } catch (e) {
      toast(describeError(e, t), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('assessmentBuilder.editDefinition')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button onClick={save} loading={busy} disabled={!title.trim()}>{t('common.save')}</Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label={t('assessmentBuilder.defTitleLabel')}>
          <Input value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t('assessmentBuilder.defDescriptionLabel')}>
          <Textarea value={description} disabled={busy} rows={2} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
