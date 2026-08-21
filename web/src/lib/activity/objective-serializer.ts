/**
 * lesson-activity-objective/v1 serializer + validator. Mirrors the backend contract
 * (src/lesson-execution/activity/objective-activity-payload.ts + common/payload/choice-question-payload.ts):
 *
 *   { schemaVersion, format, prompt, options: [{id,text}], answerKey: { correctOptionIds } }
 *
 * Structural rules (identical to the backend):
 *   - prompt: non-empty string
 *   - options: length >= 2; true_false → exactly 2; each option { id: non-empty string, text: string }; ids unique
 *   - answerKey.correctOptionIds: non-empty; each id an existing option; single_choice/true_false → exactly one
 *
 * The `answerKey` is SERVER/AUTHORING-ONLY. It is legitimately part of the authoring payload sent to the backend,
 * but it must NEVER be surfaced in the learner preview panel (see preview-view-model.ts).
 */
export const LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION = 'lesson-activity-objective/v1';

export type ObjectiveFormat = 'single_choice' | 'multiple_choice' | 'true_false';

export interface ObjectiveOption {
  id: string;
  text: string;
}
export interface ObjectiveDraft {
  format: ObjectiveFormat;
  prompt: string;
  options: ObjectiveOption[];
  correctOptionIds: string[];
}
export interface ObjectiveActivityPayload {
  schemaVersion: typeof LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION;
  format: ObjectiveFormat;
  prompt: string;
  options: ObjectiveOption[];
  answerKey: { correctOptionIds: string[] };
}

/** Build a canonical payload from a draft. Deduplicates correct ids and preserves option order. */
export function serializeObjectivePayload(draft: ObjectiveDraft): ObjectiveActivityPayload {
  const optionIds = new Set(draft.options.map((o) => o.id));
  const correct = [...new Set(draft.correctOptionIds)].filter((id) => optionIds.has(id));
  return {
    schemaVersion: LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION,
    format: draft.format,
    prompt: draft.prompt.trim(),
    options: draft.options.map((o) => ({ id: o.id, text: o.text })),
    answerKey: { correctOptionIds: correct },
  };
}

/** Faithful port of the backend validator — used to prove serialized payloads satisfy the canonical contract. */
export function isCanonicalObjectivePayload(raw: unknown): raw is ObjectiveActivityPayload {
  if (raw === null || typeof raw !== 'object') return false;
  const p = raw as Record<string, unknown>;
  if (p.schemaVersion !== LESSON_ACTIVITY_OBJECTIVE_SCHEMA_VERSION) return false;
  const format = p.format;
  if (format !== 'single_choice' && format !== 'multiple_choice' && format !== 'true_false') return false;
  if (typeof p.prompt !== 'string' || p.prompt.trim().length === 0) return false;

  if (!Array.isArray(p.options) || p.options.length < 2) return false;
  if (format === 'true_false' && p.options.length !== 2) return false;
  const ids = new Set<string>();
  for (const o of p.options) {
    if (o === null || typeof o !== 'object') return false;
    const oo = o as Record<string, unknown>;
    if (typeof oo.id !== 'string' || oo.id.trim().length === 0) return false;
    if (typeof oo.text !== 'string') return false;
    if (ids.has(oo.id)) return false;
    ids.add(oo.id);
  }

  const ak = p.answerKey;
  if (ak === null || typeof ak !== 'object') return false;
  const correct = (ak as Record<string, unknown>).correctOptionIds;
  if (!Array.isArray(correct) || correct.length === 0) return false;
  const correctSet = new Set<string>();
  for (const cid of correct) {
    if (typeof cid !== 'string' || !ids.has(cid)) return false;
    correctSet.add(cid);
  }
  if ((format === 'single_choice' || format === 'true_false') && correctSet.size !== 1) return false;
  return true;
}

/** Human-facing (Uzbek) validation message for the editor, or null when the draft is valid. */
export function objectiveDraftError(draft: ObjectiveDraft): string | null {
  if (draft.prompt.trim().length === 0) return 'Savol matni bo‘sh bo‘lishi mumkin emas.';
  if (draft.options.length < 2) return 'Kamida 2 ta variant kerak.';
  if (draft.format === 'true_false' && draft.options.length !== 2) return 'To‘g‘ri/Noto‘g‘ri uchun aynan 2 ta variant kerak.';
  const ids = new Set<string>();
  for (const o of draft.options) {
    if (o.text.trim().length === 0) return 'Har bir variant matni to‘ldirilishi kerak.';
    if (ids.has(o.id)) return 'Variant identifikatorlari takrorlanmasligi kerak.';
    ids.add(o.id);
  }
  const correct = draft.correctOptionIds.filter((id) => ids.has(id));
  if (correct.length === 0) return 'Kamida bitta to‘g‘ri javob belgilang.';
  if ((draft.format === 'single_choice' || draft.format === 'true_false') && new Set(correct).size !== 1)
    return 'Bu format uchun aynan bitta to‘g‘ri javob bo‘lishi kerak.';
  return null;
}
