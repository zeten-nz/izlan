'use client';

import { useMemo, useRef, useState } from 'react';
import { FiCheck, FiPlus, FiSave, FiTrash2 } from 'react-icons/fi';
import {
  objectiveDraftError,
  serializeObjectivePayload,
  type ObjectiveDraft,
  type ObjectiveFormat,
  type ObjectiveOption,
} from '@/lib/activity/objective-serializer';
import { useT } from '@/lib/i18n/i18n-context';
import { Button, Field, IconButton, Input, Select, Textarea } from '@/components/ui';
import { Badge } from '@/components/ui/status-badge';

const FORMAT_KEY: Record<ObjectiveFormat, string> = {
  single_choice: 'activity.formatSingle',
  multiple_choice: 'activity.formatMultiple',
  true_false: 'activity.formatTrueFalse',
};

function draftFromPayload(payload: unknown): ObjectiveDraft {
  const p = (payload ?? {}) as Record<string, unknown>;
  const fmt = p.format;
  const format: ObjectiveFormat = fmt === 'multiple_choice' || fmt === 'true_false' ? fmt : 'single_choice';
  const prompt = typeof p.prompt === 'string' ? p.prompt : '';
  const rawOptions = Array.isArray(p.options) ? (p.options as unknown[]) : [];
  const options: ObjectiveOption[] = rawOptions
    .map((o) => {
      const oo = (o ?? {}) as Record<string, unknown>;
      return { id: typeof oo.id === 'string' ? oo.id : '', text: typeof oo.text === 'string' ? oo.text : '' };
    })
    .filter((o) => o.id !== '');
  const ak = (p.answerKey ?? {}) as Record<string, unknown>;
  const correctOptionIds = Array.isArray(ak.correctOptionIds) ? (ak.correctOptionIds as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  if (options.length === 0) {
    return { format, prompt, options: [{ id: 'o1', text: '' }, { id: 'o2', text: '' }], correctOptionIds: [] };
  }
  return { format, prompt, options, correctOptionIds };
}

export function ObjectiveActivityEditor({
  initialPayload,
  initialDuration,
  editable,
  committing,
  onCommit,
}: {
  initialPayload: unknown;
  initialDuration: number | null;
  editable: boolean;
  committing: boolean;
  onCommit: (payload: unknown, durationMin: number | undefined) => Promise<void>;
}) {
  const t = useT();
  const initialDraft = useMemo(() => draftFromPayload(initialPayload), [initialPayload]);
  const [draft, setDraft] = useState<ObjectiveDraft>(initialDraft);
  const [duration, setDuration] = useState(initialDuration === null ? '' : String(initialDuration));
  const counter = useRef(draft.options.length);

  const errorKey = objectiveDraftError(draft);
  const isSingle = draft.format === 'single_choice' || draft.format === 'true_false';
  const formatLabel = (f: ObjectiveFormat) => t(FORMAT_KEY[f]);

  function setFormat(format: ObjectiveFormat) {
    setDraft((d) => {
      let options = d.options;
      let correct = d.correctOptionIds;
      if (format === 'true_false') {
        options = [
          { id: options[0]?.id ?? 'o1', text: options[0]?.text || 'To‘g‘ri' },
          { id: options[1]?.id ?? 'o2', text: options[1]?.text || 'Noto‘g‘ri' },
        ];
        correct = correct.filter((c) => options.some((o) => o.id === c)).slice(0, 1);
      }
      if (format === 'single_choice') correct = correct.slice(0, 1);
      return { ...d, format, options, correctOptionIds: correct };
    });
  }

  function addOption() {
    counter.current += 1;
    setDraft((d) => ({ ...d, options: [...d.options, { id: `o${counter.current}_${d.options.length + 1}`, text: '' }] }));
  }
  function removeOption(id: string) {
    setDraft((d) => ({ ...d, options: d.options.filter((o) => o.id !== id), correctOptionIds: d.correctOptionIds.filter((c) => c !== id) }));
  }
  function setOptionText(id: string, text: string) {
    setDraft((d) => ({ ...d, options: d.options.map((o) => (o.id === id ? { ...o, text } : o)) }));
  }
  function toggleCorrect(id: string) {
    setDraft((d) => {
      if (d.format === 'multiple_choice') {
        const has = d.correctOptionIds.includes(id);
        return { ...d, correctOptionIds: has ? d.correctOptionIds.filter((c) => c !== id) : [...d.correctOptionIds, id] };
      }
      return { ...d, correctOptionIds: [id] };
    });
  }

  if (!editable) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-xs text-muted">{formatLabel(initialDraft.format)}</p>
        <p className="font-medium text-text">{initialDraft.prompt || '—'}</p>
        <ul className="space-y-1">
          {initialDraft.options.map((o) => (
            <li key={o.id} className="flex items-center gap-2">
              {initialDraft.correctOptionIds.includes(o.id) ? <FiCheck className="text-success" aria-label={t('activity.correct')} /> : <span className="w-4" />}
              <span className="text-text">{o.text || <span className="text-muted">{t('preview.emptyOption')}</span>}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('activity.format')} htmlFor="obj-fmt">
          <Select id="obj-fmt" value={draft.format} onChange={(e) => setFormat(e.target.value as ObjectiveFormat)}>
            {(['single_choice', 'multiple_choice', 'true_false'] as ObjectiveFormat[]).map((f) => (
              <option key={f} value={f}>
                {formatLabel(f)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('activity.durationLabel')} htmlFor="obj-dur">
          <Input id="obj-dur" type="number" min={0} value={duration} onChange={(e) => setDuration(e.target.value)} />
        </Field>
      </div>

      <Field label={t('activity.prompt')} htmlFor="obj-prompt">
        <Textarea id="obj-prompt" rows={2} value={draft.prompt} onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))} />
      </Field>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-text">{isSingle ? t('activity.optionsSingle') : t('activity.optionsMultiple')}</span>
          {draft.format !== 'true_false' && (
            <Button size="sm" variant="ghost" leftIcon={<FiPlus aria-hidden />} onClick={addOption}>
              {t('activity.variant')}
            </Button>
          )}
        </div>
        <ul className="space-y-2">
          {draft.options.map((o) => {
            const checked = draft.correctOptionIds.includes(o.id);
            return (
              <li key={o.id} className="flex items-center gap-2">
                <label className="inline-flex items-center gap-1.5 text-xs text-muted">
                  <input type={isSingle ? 'radio' : 'checkbox'} name={isSingle ? 'obj-correct' : undefined} checked={checked} onChange={() => toggleCorrect(o.id)} aria-label={t('activity.correct')} />
                  {t('activity.correct')}
                </label>
                <Input value={o.text} onChange={(e) => setOptionText(o.id, e.target.value)} placeholder={t('activity.variantText')} />
                {draft.format !== 'true_false' && draft.options.length > 2 && (
                  <IconButton label={t('activity.deleteVariant')} onClick={() => removeOption(o.id)}>
                    <FiTrash2 aria-hidden />
                  </IconButton>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex items-center justify-between">
        {errorKey ? <span className="text-xs text-danger">{t(errorKey)}</span> : <Badge tone="success">{t('common.valid')}</Badge>}
        <Button
          size="sm"
          leftIcon={<FiSave aria-hidden />}
          loading={committing}
          disabled={!!errorKey}
          onClick={() => onCommit(serializeObjectivePayload(draft), duration.trim() === '' ? undefined : Number(duration))}
        >
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}
