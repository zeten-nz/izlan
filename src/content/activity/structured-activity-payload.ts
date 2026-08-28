import { ActivityPayloadInvalidError } from '../../common/errors';
import { parseNormalization, type ResolvedTextNormalization } from './text-normalization';
import type { StructuredFormat } from './activity-evidence';

/**
 * lesson-activity-structured/v1 — the ACCEPTED payload contract for deterministic STRUCTURED PRODUCTION activities:
 * `sentence_order` (arrange tokens), `fill_blank` (controlled blanks with explicit normalization), `controlled_text`
 * (a short typed answer with a bounded accepted set). Its own schemaVersion + error type + learner projection,
 * mirroring the objective (choice) contract's discipline. Every `answerKey` / `accepted` set is SERVER-ONLY — the
 * learner projector strips them; they must never reach HTTP.
 *
 * Pure module — no Nest/DB/HTTP. The authoring dispatcher, the scorer and the learner projector all consume it, so
 * the same validated shape drives authoring, scoring and rendering.
 */
export const LESSON_ACTIVITY_STRUCTURED_SCHEMA_VERSION = 'lesson-activity-structured/v1';

export interface StructuredToken {
  id: string;
  text: string;
}

/** sentence_order — learner arranges the given tokens into the one canonical correct order. */
export interface SentenceOrderPayload {
  schemaVersion: string;
  format: 'sentence_order';
  prompt: string;
  tokens: StructuredToken[];
  answerKey: { correctOrder: string[] }; // SERVER-ONLY — ordered token ids
  remediation?: string; // SERVER-ONLY authored hint, surfaced only in post-attempt feedback
}

/** fill_blank — an ordered segment list of static text + blanks; each blank has an explicit accepted-answer set. */
export type FillBlankSegment = { text: string } | { blankId: string };
export interface FillBlankPayload {
  schemaVersion: string;
  format: 'fill_blank';
  prompt: string;
  segments: FillBlankSegment[];
  blanks: Record<string, { accepted: string[] }>; // SERVER-ONLY per-blank accepted set
  normalization: ResolvedTextNormalization;
  remediation?: string; // SERVER-ONLY
}

/** controlled_text — a short typed answer accepted only against an explicit bounded set under fixed normalization. */
export interface ControlledTextPayload {
  schemaVersion: string;
  format: 'controlled_text';
  prompt: string;
  answerKey: { accepted: string[] }; // SERVER-ONLY
  normalization: ResolvedTextNormalization;
  remediation?: string; // SERVER-ONLY
}

export type StructuredActivityPayload = SentenceOrderPayload | FillBlankPayload | ControlledTextPayload;

/** Learner-facing projection — never any accepted answer / correct order / remediation. */
export type LearnerStructuredActivity =
  | { id: string; type: string; position: number; schemaVersion: string; format: 'sentence_order'; prompt: string; tokens: StructuredToken[] }
  | { id: string; type: string; position: number; schemaVersion: string; format: 'fill_blank'; prompt: string; segments: FillBlankSegment[]; blankIds: string[] }
  | { id: string; type: string; position: number; schemaVersion: string; format: 'controlled_text'; prompt: string };

function fail(): never {
  throw new ActivityPayloadInvalidError('activity payload invalid'); // generic — never leak payload/answerKey values
}

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

export function isStructuredSchema(raw: unknown): boolean {
  return raw !== null && typeof raw === 'object' && (raw as Record<string, unknown>).schemaVersion === LESSON_ACTIVITY_STRUCTURED_SCHEMA_VERSION;
}

/** Validate + normalize a raw structured payload. Fails safe on any malformed shape. */
export function parseStructuredActivityPayload(raw: unknown): StructuredActivityPayload {
  if (raw === null || typeof raw !== 'object') fail();
  const p = raw as Record<string, unknown>;
  if (p.schemaVersion !== LESSON_ACTIVITY_STRUCTURED_SCHEMA_VERSION) fail();
  const format = p.format as StructuredFormat;
  if (format === 'sentence_order') return parseSentenceOrder(p);
  if (format === 'fill_blank') return parseFillBlank(p);
  if (format === 'controlled_text') return parseControlledText(p);
  return fail();
}

function parseSentenceOrder(p: Record<string, unknown>): SentenceOrderPayload {
  if (!isNonEmptyString(p.prompt)) fail();
  const tokens = p.tokens;
  if (!Array.isArray(tokens) || tokens.length < 2) fail();
  const ids = new Set<string>();
  const parsedTokens: StructuredToken[] = [];
  for (const t of tokens as unknown[]) {
    if (t === null || typeof t !== 'object') fail();
    const id = (t as Record<string, unknown>).id;
    const text = (t as Record<string, unknown>).text;
    if (!isNonEmptyString(id) || typeof text !== 'string' || text.length === 0) fail();
    if (ids.has(id)) fail(); // token ids unique
    ids.add(id);
    parsedTokens.push({ id, text });
  }
  const ak = p.answerKey;
  if (ak === null || typeof ak !== 'object') fail();
  const correctOrder = (ak as Record<string, unknown>).correctOrder;
  if (!Array.isArray(correctOrder) || correctOrder.length !== parsedTokens.length) fail();
  const seen = new Set<string>();
  for (const id of correctOrder as unknown[]) {
    if (typeof id !== 'string' || !ids.has(id) || seen.has(id)) fail(); // a permutation of exactly the token ids
    seen.add(id);
  }
  return { schemaVersion: LESSON_ACTIVITY_STRUCTURED_SCHEMA_VERSION, format: 'sentence_order', prompt: p.prompt, tokens: parsedTokens, answerKey: { correctOrder: correctOrder as string[] }, ...remediationOf(p) };
}

function parseFillBlank(p: Record<string, unknown>): FillBlankPayload {
  if (!isNonEmptyString(p.prompt)) fail();
  const segments = p.segments;
  if (!Array.isArray(segments) || segments.length === 0) fail();
  const blankIds: string[] = [];
  const parsedSegments: FillBlankSegment[] = [];
  for (const s of segments as unknown[]) {
    if (s === null || typeof s !== 'object') fail();
    const o = s as Record<string, unknown>;
    const keys = Object.keys(o);
    if (keys.length !== 1) fail();
    if (keys[0] === 'text') {
      if (typeof o.text !== 'string' || o.text.length === 0) fail();
      parsedSegments.push({ text: o.text });
    } else if (keys[0] === 'blankId') {
      if (!isNonEmptyString(o.blankId)) fail();
      if (blankIds.includes(o.blankId)) fail(); // blank ids unique
      blankIds.push(o.blankId);
      parsedSegments.push({ blankId: o.blankId });
    } else fail();
  }
  if (blankIds.length === 0) fail(); // must have ≥1 blank
  const blanksRaw = p.blanks;
  if (blanksRaw === null || typeof blanksRaw !== 'object') fail();
  const blanksObj = blanksRaw as Record<string, unknown>;
  if (Object.keys(blanksObj).length !== blankIds.length) fail(); // exactly the segment blanks
  const blanks: Record<string, { accepted: string[] }> = {};
  for (const id of blankIds) {
    const b = blanksObj[id];
    if (b === null || typeof b !== 'object') fail();
    const accepted = (b as Record<string, unknown>).accepted;
    if (!Array.isArray(accepted) || accepted.length === 0) fail();
    for (const a of accepted as unknown[]) if (!isNonEmptyString(a)) fail(); // non-empty accepted strings
    blanks[id] = { accepted: accepted as string[] };
  }
  const normalization = parseNormalization(p.normalization);
  if (!normalization) fail();
  return { schemaVersion: LESSON_ACTIVITY_STRUCTURED_SCHEMA_VERSION, format: 'fill_blank', prompt: p.prompt, segments: parsedSegments, blanks, normalization, ...remediationOf(p) };
}

function parseControlledText(p: Record<string, unknown>): ControlledTextPayload {
  if (!isNonEmptyString(p.prompt)) fail();
  const ak = p.answerKey;
  if (ak === null || typeof ak !== 'object') fail();
  const accepted = (ak as Record<string, unknown>).accepted;
  if (!Array.isArray(accepted) || accepted.length === 0) fail();
  for (const a of accepted as unknown[]) if (!isNonEmptyString(a)) fail();
  const normalization = parseNormalization(p.normalization);
  if (!normalization) fail();
  return { schemaVersion: LESSON_ACTIVITY_STRUCTURED_SCHEMA_VERSION, format: 'controlled_text', prompt: p.prompt, answerKey: { accepted: accepted as string[] }, normalization, ...remediationOf(p) };
}

function remediationOf(p: Record<string, unknown>): { remediation?: string } {
  if (p.remediation === undefined) return {};
  if (typeof p.remediation !== 'string' || p.remediation.length === 0) fail();
  return { remediation: p.remediation };
}

/** Strip every server-only field; expose only what a learner needs to render (no accepted answers / order / remediation). */
export function projectStructuredForLearner(id: string, type: string, position: number, payload: StructuredActivityPayload): LearnerStructuredActivity {
  const base = { id, type, position, schemaVersion: payload.schemaVersion };
  if (payload.format === 'sentence_order') {
    return { ...base, format: 'sentence_order', prompt: payload.prompt, tokens: payload.tokens.map((t) => ({ id: t.id, text: t.text })) };
  }
  if (payload.format === 'fill_blank') {
    return { ...base, format: 'fill_blank', prompt: payload.prompt, segments: payload.segments, blankIds: payload.segments.filter((s): s is { blankId: string } => 'blankId' in s).map((s) => s.blankId) };
  }
  return { ...base, format: 'controlled_text', prompt: payload.prompt };
}
