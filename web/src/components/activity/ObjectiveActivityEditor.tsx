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
import {
  LESSON_ACTIVITY_STRUCTURED_SCHEMA_VERSION,
  draftFromStructuredPayload,
  emptyStructuredDraft,
  serializeStructuredPayload,
  structuredDraftError,
  type StructuredDraft,
  type StructuredFormat,
} from '@/lib/activity/structured-serializer';
import { useT } from '@/lib/i18n/i18n-context';
import { Button, Field, IconButton, Input, Select, Textarea } from '@/components/ui';
import { Badge } from '@/components/ui/status-badge';
import { StructuredActivityEditor } from './StructuredActivityEditor';

type AnyFormat = ObjectiveFormat | StructuredFormat;
const CHOICE_FORMATS: ObjectiveFormat[] = ['single_choice', 'multiple_choice', 'true_false'];
const STRUCTURED_FORMATS: StructuredFormat[] = ['sentence_order', 'fill_blank', 'controlled_text'];
const isStructuredFormat = (f: AnyFormat): f is StructuredFormat => (STRUCTURED_FORMATS as string[]).includes(f);

const FORMAT_KEY: Record<AnyFormat, string> = {
  single_choice: 'activity.formatSingle',
  multiple_choice: 'activity.formatMultiple',
  true_false: 'activity.formatTrueFalse',
  sentence_order: 'activity.structured.formatSentenceOrder',
  fill_blank: 'activity.structured.formatFillBlank',
  controlled_text: 'activity.structured.formatControlledText',
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
  if (options.length === 0) return { format, prompt, options: [{ id: 'o1', text: '' }, { id: 'o2', text: '' }], correctOptionIds: [] };
  return { format, prompt, options, correctOptionIds };
}

/**
 * The objective/deterministic activity editor — one form for the whole family: choice (single/multiple/true_false)
 * AND structured production (sentence_order / fill_blank / controlled_text), chosen from a single format selector.
 * No raw JSON: the structured sub-form authors tokens/blanks/accepted answers through friendly inputs. answerKey /
 * accepted answers are the SERVER-ONLY key (kept out of the learner preview).
 */
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
  const isStructuredPayload = ((initialPayload ?? {}) as { schemaVersion?: unknown }).schemaVersion === LESSON_ACTIVITY_STRUCTURED_SCHEMA_VERSION;
  const initialChoice = useMemo(() => draftFromPayload(initialPayload), [initialPayload]);
  const initialStructured = useMemo(() => (isStructuredPayload ? draftFromStructuredPayload(initialPayload) : emptyStructuredDraft('sentence_order')), [initialPayload, isStructuredPayload]);

  const [format, setFormatState] = useState<AnyFormat>(isStructuredPayload ? initialStructured.format : initialChoice.format);
  const [choice, setChoice] = useState<ObjectiveDraft>(initialChoice);
  const [structured, setStructured] = useState<StructuredDraft>(initialStructured);
  const [duration, setDuration] = useState(initialDuration === null ? '' : String(initialDuration));
  const counter = useRef(choice.options.length);

  const structuredMode = isStructuredFormat(format);
  const errorKey = structuredMode ? structuredDraftError(structured) : objectiveDraftError(choice);
  const isSingle = choice.format === 'single_choice' || choice.format === 'true_false';
  const formatLabel = (f: AnyFormat) => t(FORMAT_KEY[f]);

  function setFormat(f: AnyFormat) {
    setFormatState(f);
    if (isStructuredFormat(f)) {
      setStructured((d) => ({ ...d, format: f }));
      return;
    }
    setChoice((d) => {
      let options = d.options;
      let correct = d.correctOptionIds;
      if (f === 'true_false') {
        options = [{ id: options[0]?.id ?? 'o1', text: options[0]?.text || 'To‘g‘ri' }, { id: options[1]?.id ?? 'o2', text: options[1]?.text || 'Noto‘g‘ri' }];
        correct = correct.filter((c) => options.some((o) => o.id === c)).slice(0, 1);
      }
      if (f === 'single_choice') correct = correct.slice(0, 1);
      return { ...d, format: f, options, correctOptionIds: correct };
    });
  }

  function addOption() {
    counter.current += 1;
    setChoice((d) => ({ ...d, options: [...d.options, { id: `o${counter.current}_${d.options.length + 1}`, text: '' }] }));
  }
  const removeOption = (id: string) => setChoice((d) => ({ ...d, options: d.options.filter((o) => o.id !== id), correctOptionIds: d.correctOptionIds.filter((c) => c !== id) }));
  const setOptionText = (id: string, text: string) => setChoice((d) => ({ ...d, options: d.options.map((o) => (o.id === id ? { ...o, text } : o)) }));
  function toggleCorrect(id: string) {
    setChoice((d) => {
      if (d.format === 'multiple_choice') { const has = d.correctOptionIds.includes(id); return { ...d, correctOptionIds: has ? d.correctOptionIds.filter((c) => c !== id) : [...d.correctOptionIds, id] }; }
      return { ...d, correctOptionIds: [id] };
    });
  }

  function save() {
    const payload = structuredMode ? serializeStructuredPayload(structured) : serializeObjectivePayload(choice);
    return onCommit(payload, duration.trim() === '' ? undefined : Number(duration));
  }

  if (!editable) {
    if (isStructuredPayload) return <p className="text-sm text-muted">{formatLabel(initialStructured.format)} — {initialStructured.prompt || '—'}</p>;
    return (
      <div className="space-y-2 text-sm">
        <p className="text-xs text-muted">{formatLabel(initialChoice.format)}</p>
        <p className="font-medium text-text">{initialChoice.prompt || '—'}</p>
        <ul className="space-y-1">
          {initialChoice.options.map((o) => (
            <li key={o.id} className="flex items-center gap-2">
              {initialChoice.correctOptionIds.includes(o.id) ? <FiCheck className="text-success" aria-label={t('activity.correct')} /> : <span className="w-4" />}
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
          <Select id="obj-fmt" value={format} onChange={(e) => setFormat(e.target.value as AnyFormat)}>
            <optgroup label={t('activity.objectiveGroup')}>{CHOICE_FORMATS.map((f) => <option key={f} value={f}>{formatLabel(f)}</option>)}</optgroup>
            <optgroup label={t('activity.structured.group')}>{STRUCTURED_FORMATS.map((f) => <option key={f} value={f}>{formatLabel(f)}</option>)}</optgroup>
          </Select>
        </Field>
        <Field label={t('activity.durationLabel')} htmlFor="obj-dur">
          <Input id="obj-dur" type="number" min={0} value={duration} onChange={(e) => setDuration(e.target.value)} />
        </Field>
      </div>

      {structuredMode ? (
        <StructuredActivityEditor draft={structured} setDraft={setStructured} />
      ) : (
        <>
          <Field label={t('activity.prompt')} htmlFor="obj-prompt">
            <Textarea id="obj-prompt" rows={2} value={choice.prompt} onChange={(e) => setChoice((d) => ({ ...d, prompt: e.target.value }))} />
          </Field>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text">{isSingle ? t('activity.optionsSingle') : t('activity.optionsMultiple')}</span>
              {choice.format !== 'true_false' && <Button size="sm" variant="ghost" leftIcon={<FiPlus aria-hidden />} onClick={addOption}>{t('activity.variant')}</Button>}
            </div>
            <ul className="space-y-2">
              {choice.options.map((o) => {
                const checked = choice.correctOptionIds.includes(o.id);
                return (
                  <li key={o.id} className="flex items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 text-xs text-muted">
                      <input type={isSingle ? 'radio' : 'checkbox'} name={isSingle ? 'obj-correct' : undefined} checked={checked} onChange={() => toggleCorrect(o.id)} aria-label={t('activity.correct')} />
                      {t('activity.correct')}
                    </label>
                    <Input value={o.text} onChange={(e) => setOptionText(o.id, e.target.value)} placeholder={t('activity.variantText')} />
                    {choice.format !== 'true_false' && choice.options.length > 2 && <IconButton label={t('activity.deleteVariant')} onClick={() => removeOption(o.id)}><FiTrash2 aria-hidden /></IconButton>}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}

      <div className="flex items-center justify-between">
        {errorKey ? <span className="text-xs text-danger">{t(errorKey)}</span> : <Badge tone="success">{t('common.valid')}</Badge>}
        <Button size="sm" leftIcon={<FiSave aria-hidden />} loading={committing} disabled={!!errorKey} onClick={save}>{t('common.save')}</Button>
      </div>
    </div>
  );
}
