/**
 * Honest evidence semantics per activity FORMAT (activity-evidence-v1).
 *
 * The runtime mastery gate (teaching-mastery.engine) enforces score threshold + independence level — so
 * INDEPENDENCE is the trustworthy lever: a point that must prove controlled production sets minIndependence = 2,
 * which recognition-only choice evidence (independence 1) cannot satisfy. evidenceKind is the honest human-readable
 * label recorded alongside each measurement.
 *
 * Explicitly: multiple-choice / true-false is RECOGNITION, not production. Arranging tokens, filling controlled
 * blanks and typing a bounded controlled answer are CONTROLLED-PRODUCTION. Answering after canonical audio is
 * LISTENING-COMPREHENSION. Nothing here emits 'free-production' — free/independent writing needs infrastructure we
 * do not have, so it is never fabricated (a point requiring it is simply unsatisfiable until that infra exists).
 *
 * Pure module — no Nest/DB/HTTP. The single source of truth mapping an activity to what it can honestly evidence.
 */
export const ACTIVITY_EVIDENCE_VERSION = 'activity-evidence-v1';

export type EvidenceKind = 'recognition' | 'controlled-production' | 'listening-comprehension';

/** Independence ordinal: 0 guided · 1 scaffolded/recognition · 2 independent controlled-production. */
export const INDEPENDENCE_RECOGNITION = 1;
export const INDEPENDENCE_CONTROLLED_PRODUCTION = 2;
export const INDEPENDENCE_LISTENING = 1;

export interface ActivityEvidence {
  evidenceKind: EvidenceKind;
  independenceLevel: number;
}

/** The interaction family an activity belongs to (from its payload schemaVersion), independent of ActivityType. */
export type ActivityInteractionKind = 'CHOICE' | 'STRUCTURED' | 'LISTENING';

/** Structured production formats (all controlled-production evidence). */
export type StructuredFormat = 'sentence_order' | 'fill_blank' | 'controlled_text';

/**
 * The honest evidence an activity produces, from its interaction family + format. Choice → recognition@1;
 * structured → controlled-production@2; listening → listening-comprehension@1.
 */
export function evidenceForActivity(kind: ActivityInteractionKind): ActivityEvidence {
  switch (kind) {
    case 'CHOICE':
      return { evidenceKind: 'recognition', independenceLevel: INDEPENDENCE_RECOGNITION };
    case 'STRUCTURED':
      return { evidenceKind: 'controlled-production', independenceLevel: INDEPENDENCE_CONTROLLED_PRODUCTION };
    case 'LISTENING':
      return { evidenceKind: 'listening-comprehension', independenceLevel: INDEPENDENCE_LISTENING };
  }
}

/** All evidence kinds an authored activity of a given interaction family can produce (readiness satisfiability). */
export function producibleEvidence(kind: ActivityInteractionKind): ActivityEvidence {
  return evidenceForActivity(kind);
}
