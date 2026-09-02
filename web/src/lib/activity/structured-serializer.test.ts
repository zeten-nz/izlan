import { describe, it, expect } from 'vitest';
import { serializeStructuredPayload, structuredDraftError, draftFromStructuredPayload, emptyStructuredDraft } from './structured-serializer';

describe('structured-serializer (mirrors backend lesson-activity-structured/v1)', () => {
  it('SS-01 sentence_order: words become tokens + correctOrder', () => {
    const d = { ...emptyStructuredDraft('sentence_order'), prompt: 'Order.', sentence: 'She works here' };
    expect(structuredDraftError(d)).toBeNull();
    const p = serializeStructuredPayload(d) as { tokens: { id: string; text: string }[]; answerKey: { correctOrder: string[] } };
    expect(p.tokens.map((t) => t.text)).toEqual(['She', 'works', 'here']);
    expect(p.answerKey.correctOrder).toEqual(['t1', 't2', 't3']);
  });

  it('SS-02 fill_blank: {a|b} markers become segments + per-blank accepted sets', () => {
    const d = { ...emptyStructuredDraft('fill_blank'), prompt: 'Fill.', template: 'I have {an|a} apple.' };
    expect(structuredDraftError(d)).toBeNull();
    const p = serializeStructuredPayload(d) as { segments: unknown[]; blanks: Record<string, { accepted: string[] }> };
    expect(p.segments).toEqual([{ text: 'I have ' }, { blankId: 'b1' }, { text: ' apple.' }]);
    expect(p.blanks.b1!.accepted).toEqual(['an', 'a']);
  });

  it('SS-03 controlled_text: one accepted answer per line', () => {
    const d = { ...emptyStructuredDraft('controlled_text'), prompt: 'Plural of box?', accepted: 'boxes\n' };
    const p = serializeStructuredPayload(d) as { answerKey: { accepted: string[] }; normalization: { caseFold: boolean } };
    expect(p.answerKey.accepted).toEqual(['boxes']);
    expect(p.normalization.caseFold).toBe(true);
  });

  it('SS-04 validation flags empty/malformed drafts (mirrors backend rejection)', () => {
    expect(structuredDraftError({ ...emptyStructuredDraft('sentence_order'), prompt: 'x', sentence: 'one' })).toBe('activity.structured.errSentence');
    expect(structuredDraftError({ ...emptyStructuredDraft('fill_blank'), prompt: 'x', template: 'no blanks here' })).toBe('activity.structured.errNoBlank');
    expect(structuredDraftError({ ...emptyStructuredDraft('fill_blank'), prompt: 'x', template: 'a {} b' })).toBe('activity.structured.errBlankAnswer');
    expect(structuredDraftError({ ...emptyStructuredDraft('controlled_text'), prompt: 'x', accepted: '   ' })).toBe('activity.structured.errAccepted');
    expect(structuredDraftError({ ...emptyStructuredDraft('sentence_order'), prompt: '', sentence: 'a b' })).toBe('activity.structured.errPrompt');
  });

  it('SS-05 round-trips: payload → draft → payload is stable for editing', () => {
    for (const d of [
      { ...emptyStructuredDraft('sentence_order'), prompt: 'p', sentence: 'She works here' },
      { ...emptyStructuredDraft('fill_blank'), prompt: 'p', template: 'I have {an} apple.' },
      { ...emptyStructuredDraft('controlled_text'), prompt: 'p', accepted: 'boxes' },
    ]) {
      const payload = serializeStructuredPayload(d);
      const back = draftFromStructuredPayload(payload);
      expect(serializeStructuredPayload(back)).toEqual(payload);
    }
  });
});
