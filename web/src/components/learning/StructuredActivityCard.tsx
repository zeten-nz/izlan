'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { FiRotateCcw, FiX } from 'react-icons/fi';
import { Button, Input } from '@/components/ui';
import { useT } from '@/lib/i18n/i18n-context';
import type { LearnerActivity, StructuredAnswer } from '@/lib/api/types';

/**
 * Renders a structured PRODUCTION activity (sentence_order / fill_blank / controlled_text) and builds the exact
 * server answer body — the learner produces language rather than picking a letter. It owns only the in-progress
 * answer; the server remains the sole scoring authority (no correctness shown here — the runner shows feedback).
 * Accessible + mobile-first: tokens are ordered by tapping chips; blanks and short answers are plain inputs.
 */
type Structured = Extract<LearnerActivity, { format: 'sentence_order' | 'fill_blank' | 'controlled_text' }>;

export function StructuredActivityCard({
  activity,
  onSubmit,
  submitting,
  submitLabel,
  questionLabel,
}: {
  activity: Structured;
  onSubmit: (answer: StructuredAnswer) => void;
  submitting?: boolean;
  submitLabel: string;
  questionLabel?: string;
}) {
  const t = useT();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, [activity.id]);

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-3.5">
        {questionLabel && <span className="text-[12.5px] font-semibold text-muted">{questionLabel}</span>}
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold leading-snug tracking-tight text-text outline-none">{activity.prompt}</h1>
      </div>
      {activity.format === 'sentence_order' && <SentenceOrder activity={activity} onSubmit={onSubmit} submitting={submitting} submitLabel={submitLabel} t={t} />}
      {activity.format === 'fill_blank' && <FillBlank activity={activity} onSubmit={onSubmit} submitting={submitting} submitLabel={submitLabel} />}
      {activity.format === 'controlled_text' && <ControlledText onSubmit={onSubmit} submitting={submitting} submitLabel={submitLabel} placeholder={t('learner.structured.typeAnswer')} />}
    </div>
  );
}

type TFunc = (k: string, v?: Record<string, string | number>) => string;

function SentenceOrder({ activity, onSubmit, submitting, submitLabel, t }: { activity: Extract<Structured, { format: 'sentence_order' }>; onSubmit: (a: StructuredAnswer) => void; submitting?: boolean; submitLabel: string; t: TFunc }) {
  const [order, setOrder] = useState<string[]>([]);
  useEffect(() => { setOrder([]); }, [activity.id]);
  const textById = useMemo(() => new Map(activity.tokens.map((tok) => [tok.id, tok.text])), [activity.tokens]);
  const remaining = activity.tokens.filter((tok) => !order.includes(tok.id));
  const canSubmit = order.length === activity.tokens.length;

  return (
    <div className="flex flex-col gap-5">
      {/* The sentence being built. */}
      <div aria-label={t('learner.structured.yourSentence')} className="flex min-h-[3rem] flex-wrap items-center gap-2 rounded-panel border border-border bg-surface-2 p-3">
        {order.length === 0 && <span className="text-sm text-muted">{t('learner.structured.tapToBuild')}</span>}
        {order.map((id, i) => (
          <button key={id} type="button" disabled={submitting} onClick={() => setOrder((o) => o.filter((_, j) => j !== i))} className="inline-flex items-center gap-1 rounded-control bg-primary/10 px-3 py-1.5 text-sm font-medium text-text hover:bg-primary/20">
            {textById.get(id)} <FiX aria-hidden size={13} />
          </button>
        ))}
      </div>
      {/* The token bank. */}
      <div className="flex flex-wrap gap-2">
        {remaining.map((tok) => (
          <button key={tok.id} type="button" disabled={submitting} onClick={() => setOrder((o) => [...o, tok.id])} className="rounded-control border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text hover:bg-surface-2">
            {tok.text}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOrder([])} disabled={submitting || order.length === 0}><FiRotateCcw aria-hidden /> {t('learner.structured.reset')}</Button>
        <Button type="button" size="xl" className="min-w-[200px]" disabled={!canSubmit || submitting} loading={submitting} onClick={() => onSubmit({ orderedTokenIds: order })}>{submitLabel}</Button>
      </div>
    </div>
  );
}

function FillBlank({ activity, onSubmit, submitting, submitLabel }: { activity: Extract<Structured, { format: 'fill_blank' }>; onSubmit: (a: StructuredAnswer) => void; submitting?: boolean; submitLabel: string }) {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => { setValues({}); }, [activity.id]);
  const canSubmit = activity.blankIds.every((id) => (values[id] ?? '').trim().length > 0);

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (canSubmit && !submitting) onSubmit({ blanks: values }); }} className="flex flex-col gap-6" noValidate>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-3 text-lg leading-relaxed text-text">
        {activity.segments.map((seg, i) =>
          'text' in seg ? (
            <span key={i}>{seg.text}</span>
          ) : (
            <input
              key={i}
              aria-label={`blank ${seg.blankId}`}
              value={values[seg.blankId] ?? ''}
              disabled={submitting}
              onChange={(e) => setValues((v) => ({ ...v, [seg.blankId]: e.target.value }))}
              className="inline-block w-28 rounded-control border-b-2 border-primary bg-surface-2 px-2 py-1 text-center text-base font-medium text-text focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          ),
        )}
      </p>
      <div className="flex justify-end">
        <Button type="submit" size="xl" className="min-w-[200px]" disabled={!canSubmit || submitting} loading={submitting}>{submitLabel}</Button>
      </div>
    </form>
  );
}

function ControlledText({ onSubmit, submitting, submitLabel, placeholder }: { onSubmit: (a: StructuredAnswer) => void; submitting?: boolean; submitLabel: string; placeholder: string }) {
  const [text, setText] = useState('');
  const canSubmit = text.trim().length > 0;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (canSubmit && !submitting) onSubmit({ text }); }} className="flex flex-col gap-6" noValidate>
      <Input value={text} disabled={submitting} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} maxLength={200} />
      <div className="flex justify-end">
        <Button type="submit" size="xl" className="min-w-[200px]" disabled={!canSubmit || submitting} loading={submitting}>{submitLabel}</Button>
      </div>
    </form>
  );
}
