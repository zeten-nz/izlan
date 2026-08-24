'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { AnswerOption } from './AnswerOption';
import type { LearnerFacingItem, PlacementAnswer } from '@/lib/api/types';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/**
 * Canonical Question System card. Renders a prompt + selectable options + a deliberate submit — the first reusable
 * question component (Placement now; Lesson Practice / Review / Assessment preview later). It owns the selection and
 * builds the real answer body: `{selectedOptionId}` for single_choice/true_false, `{selectedOptionIds}` for
 * multiple_choice. Selection resets and focus moves to the heading whenever the item changes.
 *
 * PLACEMENT RULE (honored by not doing it here): NO immediate correctness feedback — no correct/wrong colouring, no
 * explanation, no score. The caller submits and simply advances to whatever the backend returns next.
 */
export function QuestionCard({
  item,
  onSubmit,
  submitting,
  submitLabel,
  questionLabel,
}: {
  item: LearnerFacingItem;
  onSubmit: (answer: PlacementAnswer) => void;
  submitting?: boolean;
  submitLabel: string;
  questionLabel?: string;
}) {
  const multi = item.format === 'multiple_choice';
  const [single, setSingle] = useState<string | null>(null);
  const [multiSel, setMultiSel] = useState<string[]>([]);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setSingle(null);
    setMultiSel([]);
    headingRef.current?.focus();
  }, [item.id]);

  const canSubmit = multi ? multiSel.length > 0 : single !== null;

  function toggleMulti(id: string) {
    setMultiSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || !canSubmit) return;
    onSubmit(multi ? { selectedOptionIds: multiSel } : { selectedOptionId: single! });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-7" noValidate>
      <div className="flex flex-col gap-3.5">
        {questionLabel && <span className="text-[12.5px] font-semibold text-muted">{questionLabel}</span>}
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold leading-snug tracking-tight text-text outline-none">
          {item.prompt}
        </h1>
      </div>

      <div role={multi ? 'group' : 'radiogroup'} aria-label={item.prompt} className="flex flex-col gap-2.5">
        {(item.options ?? []).map((opt, i) => (
          <AnswerOption
            key={opt.id}
            letter={LETTERS[i] ?? '•'}
            text={opt.text}
            type={multi ? 'checkbox' : 'radio'}
            name={multi ? undefined : `q-${item.id}`}
            checked={multi ? multiSel.includes(opt.id) : single === opt.id}
            disabled={submitting}
            onChange={() => (multi ? toggleMulti(opt.id) : setSingle(opt.id))}
          />
        ))}
      </div>

      <div className="flex justify-end">
        <Button type="submit" size="xl" disabled={!canSubmit || submitting} loading={submitting} className="min-w-[200px]">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
