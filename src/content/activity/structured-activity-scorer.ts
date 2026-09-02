import { ActivityInvalidResponseError } from '../../common/errors';
import { normalizeText } from './text-normalization';
import type { StructuredActivityPayload, SentenceOrderPayload, FillBlankPayload, ControlledTextPayload } from './structured-activity-payload';

/**
 * Deterministic scoring for lesson-activity-structured/v1. Exact-match after the payload's EXPLICIT normalization —
 * no fuzzy matching, edit distance, or synonym acceptance. 10000 correct / 0 incorrect (no partial credit; a
 * fill_blank with any wrong blank is wrong). Malformed answers throw ActivityInvalidResponseError and never leak
 * accepted answers. Feedback is learner-SAFE: a stable format hint code, which blanks need attention (ids only,
 * never values), and the author's remediation string — never the accepted set or correct order.
 */
export interface StructuredFeedback {
  hint: string; // stable code the client maps to learner copy (e.g. 'sentence_order' | 'fill_blank' | 'controlled_text')
  remediation?: string; // authored, learner-safe
  incorrectBlankIds?: string[]; // fill_blank only — which blanks are wrong (ids, never the expected text)
}

export interface StructuredScore {
  isCorrect: boolean;
  deterministicScore: number; // 0..10000
  feedback: StructuredFeedback;
}

const CORRECT_BP = 10000;
const INCORRECT_BP = 0;

export function scoreStructured(payload: StructuredActivityPayload, answer: unknown): StructuredScore {
  if (payload.format === 'sentence_order') return scoreSentenceOrder(payload, answer);
  if (payload.format === 'fill_blank') return scoreFillBlank(payload, answer);
  return scoreControlledText(payload, answer);
}

export function canonicalizeStructured(payload: StructuredActivityPayload, answer: unknown): string {
  if (payload.format === 'sentence_order') return 'so:' + readOrderedTokenIds(payload, answer).join(',');
  if (payload.format === 'fill_blank') {
    const filled = readBlanks(payload, answer);
    return 'fb:' + Object.keys(payload.blanks).sort().map((id) => `${id}=${normalizeText(filled[id], payload.normalization)}`).join('|');
  }
  return 'ct:' + normalizeText(readText(answer), payload.normalization);
}

function scoreSentenceOrder(payload: SentenceOrderPayload, answer: unknown): StructuredScore {
  const ordered = readOrderedTokenIds(payload, answer);
  const isCorrect = ordered.length === payload.answerKey.correctOrder.length && ordered.every((id, i) => id === payload.answerKey.correctOrder[i]);
  return { isCorrect, deterministicScore: isCorrect ? CORRECT_BP : INCORRECT_BP, feedback: feedback('sentence_order', payload.remediation, isCorrect) };
}

function scoreFillBlank(payload: FillBlankPayload, answer: unknown): StructuredScore {
  const filled = readBlanks(payload, answer);
  const incorrectBlankIds: string[] = [];
  for (const id of Object.keys(payload.blanks)) {
    const given = normalizeText(filled[id], payload.normalization);
    const accepted = new Set(payload.blanks[id].accepted.map((a) => normalizeText(a, payload.normalization)));
    if (!accepted.has(given)) incorrectBlankIds.push(id);
  }
  const isCorrect = incorrectBlankIds.length === 0;
  const fb: StructuredFeedback = { hint: 'fill_blank', ...(payload.remediation && !isCorrect ? { remediation: payload.remediation } : {}), ...(isCorrect ? {} : { incorrectBlankIds }) };
  return { isCorrect, deterministicScore: isCorrect ? CORRECT_BP : INCORRECT_BP, feedback: fb };
}

function scoreControlledText(payload: ControlledTextPayload, answer: unknown): StructuredScore {
  const given = normalizeText(readText(answer), payload.normalization);
  const accepted = new Set(payload.answerKey.accepted.map((a) => normalizeText(a, payload.normalization)));
  const isCorrect = accepted.has(given);
  return { isCorrect, deterministicScore: isCorrect ? CORRECT_BP : INCORRECT_BP, feedback: feedback('controlled_text', payload.remediation, isCorrect) };
}

function feedback(hint: string, remediation: string | undefined, isCorrect: boolean): StructuredFeedback {
  return { hint, ...(remediation && !isCorrect ? { remediation } : {}) };
}

// ── answer readers (throw ActivityInvalidResponseError; never leak values) ──

function readOrderedTokenIds(payload: SentenceOrderPayload, answer: unknown): string[] {
  if (answer === null || typeof answer !== 'object') throw new ActivityInvalidResponseError('malformed answer');
  const keys = Object.keys(answer);
  if (keys.length !== 1 || keys[0] !== 'orderedTokenIds') throw new ActivityInvalidResponseError('unexpected answer fields');
  const arr = (answer as Record<string, unknown>).orderedTokenIds;
  const tokenIds = new Set(payload.tokens.map((t) => t.id));
  if (!Array.isArray(arr) || arr.length !== payload.tokens.length) throw new ActivityInvalidResponseError('wrong token count');
  const seen = new Set<string>();
  for (const id of arr) {
    if (typeof id !== 'string' || !tokenIds.has(id)) throw new ActivityInvalidResponseError('unknown token');
    if (seen.has(id)) throw new ActivityInvalidResponseError('duplicate token');
    seen.add(id);
  }
  return arr as string[];
}

function readBlanks(payload: FillBlankPayload, answer: unknown): Record<string, string> {
  if (answer === null || typeof answer !== 'object') throw new ActivityInvalidResponseError('malformed answer');
  const keys = Object.keys(answer);
  if (keys.length !== 1 || keys[0] !== 'blanks') throw new ActivityInvalidResponseError('unexpected answer fields');
  const blanks = (answer as Record<string, unknown>).blanks;
  if (blanks === null || typeof blanks !== 'object' || Array.isArray(blanks)) throw new ActivityInvalidResponseError('malformed answer');
  const b = blanks as Record<string, unknown>;
  const expected = Object.keys(payload.blanks).sort();
  const got = Object.keys(b).sort();
  if (got.length !== expected.length || got.some((id, i) => id !== expected[i])) throw new ActivityInvalidResponseError('blank set mismatch');
  const out: Record<string, string> = {};
  for (const id of expected) {
    if (typeof b[id] !== 'string') throw new ActivityInvalidResponseError('blank must be text');
    out[id] = b[id] as string;
  }
  return out;
}

function readText(answer: unknown): string {
  if (answer === null || typeof answer !== 'object') throw new ActivityInvalidResponseError('malformed answer');
  const keys = Object.keys(answer);
  if (keys.length !== 1 || keys[0] !== 'text') throw new ActivityInvalidResponseError('unexpected answer fields');
  const text = (answer as Record<string, unknown>).text;
  if (typeof text !== 'string') throw new ActivityInvalidResponseError('text must be a string');
  return text;
}
