'use client';

import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button, Field, Input, Textarea } from '@/components/ui';
import { ConflictBanner } from '@/components/ui/conflict-banner';
import { isEditConflict } from '@/lib/api/errors';
import { describeError } from '@/lib/ui/error-text';
import { useT } from '@/lib/i18n/i18n-context';

export interface FieldSpec {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'number';
  required?: boolean;
  placeholder?: string;
  hint?: string;
}
export type FormValues = Record<string, string>;

/**
 * Field-spec-driven create/edit dialog for hierarchy/skill entities. Collects values only; the parent performs the
 * mutation (owning the OCC token). On CONTENT_EDIT_CONFLICT it shows the safe conflict banner and never auto-retries.
 */
export function EntityFormDialog({
  open,
  title,
  fields,
  initial,
  submitLabel,
  onSubmit,
  onClose,
  onConflictReload,
}: {
  open: boolean;
  title: string;
  fields: FieldSpec[];
  initial?: FormValues;
  submitLabel?: string;
  onSubmit: (values: FormValues) => Promise<void>;
  onClose: () => void;
  onConflictReload?: () => void;
}) {
  const t = useT();
  const [values, setValues] = useState<FormValues>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown | null>(null);

  useEffect(() => {
    if (open) {
      setValues(initial ?? {});
      setError(null);
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const missingRequired = fields.some((f) => f.required && (values[f.name] ?? '').trim().length === 0);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(values);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} loading={busy} disabled={missingRequired}>
            {submitLabel ?? t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error != null && isEditConflict(error) ? (
          <ConflictBanner
            onReload={() => {
              onConflictReload?.();
              onClose();
            }}
            onCancel={onClose}
          />
        ) : error != null ? (
          <p className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{describeError(error, t)}</p>
        ) : null}

        {fields.map((f) => (
          <Field key={f.name} label={f.label + (f.required ? ' *' : '')} htmlFor={`f-${f.name}`} hint={f.hint}>
            {f.type === 'textarea' ? (
              <Textarea
                id={`f-${f.name}`}
                rows={3}
                placeholder={f.placeholder}
                value={values[f.name] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              />
            ) : (
              <Input
                id={`f-${f.name}`}
                type={f.type === 'number' ? 'number' : 'text'}
                placeholder={f.placeholder}
                value={values[f.name] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              />
            )}
          </Field>
        ))}
      </div>
    </Dialog>
  );
}
