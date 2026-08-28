/**
 * Student Assistant provider PORT. Faqat abstraksiya — production-safe AI provider YO'Q (SMS_PORT bilan bir xil
 * pattern). Vendor tiplari AssistantModule'dan tashqariga chiqmaydi. Default adapter fail-closed (UNAVAILABLE),
 * shu sabab kunlik o'qish AI'siz ham to'liq ishlaydi.
 *
 * The assistant is ADVISORY only: it never makes canonical curriculum decisions, never publishes content, never
 * creates mastery/acquisition evidence, never marks an answer correct, never mutates a roadmap or session, and
 * never invents provenance. It receives a strict SUBSET of what the learner already sees — never an answerKey,
 * token, secret, hidden scoring internal, or unrelated PII (§ context safety).
 */

export const ASSISTANT_PORT = Symbol('ASSISTANT_PORT');

/**
 * A bounded set of pedagogical intents the learner can ask for. The provider decides HOW to help; the domain
 * decides WHAT it is allowed to see. HINT/EXPLAIN/EXAMPLE/SIMPLIFY are pre-submission-safe (must never reveal the
 * answer); WHY_WRONG is only meaningful AFTER an incorrect submission (uses the server-side result, not internals).
 */
export type AssistantTask = 'EXPLAIN_DIFFERENTLY' | 'ANOTHER_EXAMPLE' | 'WHY_WRONG' | 'SIMPLIFY' | 'HINT' | 'QUESTION';

export type AssistantLanguage = 'uz' | 'ru' | 'en';

/**
 * Learner-safe context — assembled by AssistantService from the learner's OWN teaching-session view (which is
 * already answer-key-free). Deliberately minimal: no ids the learner shouldn't reason about, no scores, no
 * answer keys, no tokens. `hasRecentMistake` is a server-derived boolean (last objective attempt was incorrect),
 * NOT the deterministic score — the assistant never sees hidden scoring internals.
 */
export interface AssistantContext {
  pointTitle: string;
  learningOutcome: string | null;
  stageType: string | null; // concept | recognition | production | mastery
  stageTitle: string | null;
  stageDescription: string | null;
  hasRecentMistake: boolean;
}

export interface AssistantRequest {
  task: AssistantTask;
  question: string | null; // only for QUESTION; already trimmed + length-bounded by the service
  context: AssistantContext;
  language: AssistantLanguage;
}

/** ANSWERED = help produced; UNAVAILABLE = no provider / provider failed (learning continues); DECLINED = the ask is not answerable safely yet (e.g. WHY_WRONG before any incorrect submission). */
export type AssistantStatus = 'ANSWERED' | 'UNAVAILABLE' | 'DECLINED';

export interface AssistantResult {
  status: AssistantStatus;
  message: string | null; // bounded tutor text; null unless ANSWERED
}

export interface AssistantPort {
  ask(request: AssistantRequest): Promise<AssistantResult>;
}
