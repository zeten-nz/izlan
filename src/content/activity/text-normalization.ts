/**
 * Versioned, EXPLICIT text normalization for deterministic controlled-text scoring (text-normalization-v1).
 *
 * There is NO fuzzy matching, edit distance, stemming, or synonym expansion here — a learner answer is accepted
 * ONLY if, after the author-declared transformations, it EXACTLY equals a declared accepted answer. Every
 * transformation is opt-in and pedagogically justified; nothing silently accepts materially wrong grammar. If more
 * than one answer is linguistically valid, the author must enumerate each accepted answer explicitly.
 *
 * Pure module — no Nest/DB/HTTP. Shared by the authoring validator and the runtime scorer so the SAME rules decide
 * acceptance at authoring-preview time and at learner-submit time.
 */
export const TEXT_NORMALIZATION_VERSION = 'text-normalization-v1';

export interface TextNormalization {
  /** Lowercase both sides (default true) — for A1 form drills, case is usually pedagogically irrelevant. */
  caseFold?: boolean;
  /** Trim + collapse internal whitespace runs to a single space (default true) — typing artifacts, never grammar. */
  collapseWhitespace?: boolean;
  /** Remove a fixed ASCII punctuation set (default false) — enable ONLY where punctuation is not being taught. */
  stripPunctuation?: boolean;
}

/** The resolved (all-defaults-applied) normalization actually used — stored/echoable for later interpretation. */
export interface ResolvedTextNormalization {
  version: string;
  caseFold: boolean;
  collapseWhitespace: boolean;
  stripPunctuation: boolean;
}

const STRIPPABLE_PUNCTUATION = /[.,!?;:"'()]/g;

export function resolveNormalization(n?: TextNormalization): ResolvedTextNormalization {
  return {
    version: TEXT_NORMALIZATION_VERSION,
    caseFold: n?.caseFold ?? true,
    collapseWhitespace: n?.collapseWhitespace ?? true,
    stripPunctuation: n?.stripPunctuation ?? false,
  };
}

/** Apply the resolved normalization. Order is fixed + deterministic: strip-punct → collapse-ws → case-fold → trim. */
export function normalizeText(raw: string, resolved: ResolvedTextNormalization): string {
  let s = raw;
  if (resolved.stripPunctuation) s = s.replace(STRIPPABLE_PUNCTUATION, ' ');
  if (resolved.collapseWhitespace) s = s.replace(/\s+/g, ' ');
  if (resolved.caseFold) s = s.toLowerCase();
  return s.trim();
}

/** Validate an authored normalization object (unknown extra keys rejected upstream). Returns the resolved form. */
export function parseNormalization(raw: unknown): ResolvedTextNormalization | null {
  if (raw === undefined || raw === null) return resolveNormalization();
  if (typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== 'caseFold' && k !== 'collapseWhitespace' && k !== 'stripPunctuation') return null;
  for (const k of ['caseFold', 'collapseWhitespace', 'stripPunctuation'] as const) if (o[k] !== undefined && typeof o[k] !== 'boolean') return null;
  return resolveNormalization(o as TextNormalization);
}
