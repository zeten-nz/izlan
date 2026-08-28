import { apiRequest } from './client';

/**
 * V2 Student Assistant API — an ADVISORY, context-aware tutor scoped to the learner's own teaching session. The
 * server owns all context assembly (answer-key-free) and never mutates authoritative state. The task set is a
 * closed enum (no free-form provider prompt from the client). A missing/failing provider returns UNAVAILABLE (200),
 * so the assistant is always safe to call and the UI degrades gracefully without ever blocking learning.
 */

export type AssistantTask = 'EXPLAIN_DIFFERENTLY' | 'ANOTHER_EXAMPLE' | 'WHY_WRONG' | 'SIMPLIFY' | 'HINT' | 'QUESTION';
export type AssistantLanguage = 'uz' | 'ru' | 'en';
export type AssistantStatus = 'ANSWERED' | 'UNAVAILABLE' | 'DECLINED';

export interface AssistantResult {
  status: AssistantStatus;
  message: string | null; // bounded tutor text; null unless ANSWERED
}

export interface AskAssistantInput {
  task: AssistantTask;
  question?: string; // only meaningful for QUESTION
  language?: AssistantLanguage;
}

/** POST /api/v2/assistant/teaching-sessions/:sessionId/ask — always resolves (ANSWERED/DECLINED/UNAVAILABLE), never 5xx. */
export function askAssistant(sessionId: string, input: AskAssistantInput): Promise<AssistantResult> {
  return apiRequest<AssistantResult>(`/api/v2/assistant/teaching-sessions/${sessionId}/ask`, {
    method: 'POST',
    body: { task: input.task, ...(input.question ? { question: input.question } : {}), ...(input.language ? { language: input.language } : {}) },
  });
}
