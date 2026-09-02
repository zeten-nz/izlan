/**
 * lesson-activity-structured/v1 authoring serializer + validator (mirrors the backend contract). It lets a Methodist
 * author structured production WITHOUT raw JSON:
 *  - sentence_order: type the correct sentence; each word becomes an orderable token (correct order = the sentence).
 *  - fill_blank: write the sentence with {answer} or {a|b} markers for each blank (pipe = alternative accepted answers).
 *  - controlled_text: a prompt + one accepted answer per line.
 * Normalization (case/whitespace/punctuation) is explicit + versioned; the resulting payload is exactly what the
 * backend validates and scores. The accepted answers / correct order are the SERVER-ONLY answer key.
 */
export const LESSON_ACTIVITY_STRUCTURED_SCHEMA_VERSION = 'lesson-activity-structured/v1';

export type StructuredFormat = 'sentence_order' | 'fill_blank' | 'controlled_text';

export interface StructuredDraft {
  format: StructuredFormat;
  prompt: string;
  sentence: string; // sentence_order: the correct sentence
  template: string; // fill_blank: sentence with {answer} / {a|b} blank markers
  accepted: string; // controlled_text: newline-separated accepted answers
  caseFold: boolean;
  collapseWhitespace: boolean;
  stripPunctuation: boolean;
  remediation: string;
}

export function emptyStructuredDraft(format: StructuredFormat): StructuredDraft {
  return { format, prompt: '', sentence: '', template: '', accepted: '', caseFold: true, collapseWhitespace: true, stripPunctuation: false, remediation: '' };
}

const BLANK_RE = /\{([^{}]*)\}/g;

/** i18n error key, or null when valid. Structural rules identical to the backend parser. */
export function structuredDraftError(d: StructuredDraft): string | null {
  if (d.prompt.trim().length === 0) return 'activity.structured.errPrompt';
  if (d.format === 'sentence_order') {
    const words = d.sentence.trim().split(/\s+/).filter(Boolean);
    if (words.length < 2) return 'activity.structured.errSentence';
  }
  if (d.format === 'fill_blank') {
    const blanks = [...d.template.matchAll(BLANK_RE)];
    if (blanks.length === 0) return 'activity.structured.errNoBlank';
    for (const b of blanks) if ((b[1] ?? "").split('|').map((s) => s.trim()).filter(Boolean).length === 0) return 'activity.structured.errBlankAnswer';
  }
  if (d.format === 'controlled_text') {
    if (acceptedList(d.accepted).length === 0) return 'activity.structured.errAccepted';
  }
  return null;
}

function acceptedList(raw: string): string[] {
  return raw.split('\n').map((s) => s.trim()).filter(Boolean);
}

function normalization(d: StructuredDraft) {
  return { caseFold: d.caseFold, collapseWhitespace: d.collapseWhitespace, stripPunctuation: d.stripPunctuation };
}

/** Build the canonical structured payload from a (valid) draft. */
export function serializeStructuredPayload(d: StructuredDraft): Record<string, unknown> {
  const base: Record<string, unknown> = { schemaVersion: LESSON_ACTIVITY_STRUCTURED_SCHEMA_VERSION, format: d.format, prompt: d.prompt.trim() };
  if (d.remediation.trim()) base.remediation = d.remediation.trim();
  if (d.format === 'sentence_order') {
    const words = d.sentence.trim().split(/\s+/).filter(Boolean);
    const tokens = words.map((text, i) => ({ id: `t${i + 1}`, text }));
    return { ...base, tokens, answerKey: { correctOrder: tokens.map((t) => t.id) } };
  }
  if (d.format === 'fill_blank') {
    const segments: ({ text: string } | { blankId: string })[] = [];
    const blanks: Record<string, { accepted: string[] }> = {};
    let last = 0;
    let n = 0;
    for (const m of d.template.matchAll(BLANK_RE)) {
      const before = d.template.slice(last, m.index);
      if (before) segments.push({ text: before });
      n += 1;
      const id = `b${n}`;
      segments.push({ blankId: id });
      blanks[id] = { accepted: (m[1] ?? "").split('|').map((s) => s.trim()).filter(Boolean) };
      last = (m.index ?? 0) + m[0].length;
    }
    const tail = d.template.slice(last);
    if (tail) segments.push({ text: tail });
    return { ...base, segments, blanks, normalization: normalization(d) };
  }
  return { ...base, answerKey: { accepted: acceptedList(d.accepted) }, normalization: normalization(d) };
}

/** Best-effort reverse (for editing an existing structured payload). */
export function draftFromStructuredPayload(payload: unknown): StructuredDraft {
  const p = (payload ?? {}) as Record<string, unknown>;
  const fmt = p.format;
  const format: StructuredFormat = fmt === 'fill_blank' || fmt === 'controlled_text' ? fmt : 'sentence_order';
  const d = emptyStructuredDraft(format);
  d.prompt = typeof p.prompt === 'string' ? p.prompt : '';
  d.remediation = typeof p.remediation === 'string' ? p.remediation : '';
  const norm = (p.normalization ?? {}) as Record<string, unknown>;
  d.caseFold = norm.caseFold !== false;
  d.collapseWhitespace = norm.collapseWhitespace !== false;
  d.stripPunctuation = norm.stripPunctuation === true;
  if (format === 'sentence_order' && Array.isArray(p.tokens)) {
    const byId = new Map((p.tokens as { id: string; text: string }[]).map((t) => [t.id, t.text]));
    const order = ((p.answerKey as { correctOrder?: string[] } | undefined)?.correctOrder ?? [...byId.keys()]);
    d.sentence = order.map((id) => byId.get(id) ?? '').join(' ').trim();
  }
  if (format === 'fill_blank' && Array.isArray(p.segments)) {
    const blanks = (p.blanks ?? {}) as Record<string, { accepted: string[] }>;
    d.template = (p.segments as ({ text: string } | { blankId: string })[]).map((s) => ('text' in s ? s.text : `{${(blanks[s.blankId]?.accepted ?? []).join('|')}}`)).join('');
  }
  if (format === 'controlled_text') d.accepted = (((p.answerKey as { accepted?: string[] } | undefined)?.accepted) ?? []).join('\n');
  return d;
}
