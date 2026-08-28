import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TeachingSessionService, TeachingSessionView, TeachingStageView } from '../learning-core/teaching-session.service';
import { ASSISTANT_PORT, AssistantContext, AssistantLanguage, AssistantPort, AssistantResult, AssistantTask } from './assistant.port';

const MAX_QUESTION_CHARS = 500;
const MAX_MESSAGE_CHARS = 1200;

/**
 * Student Assistant orchestration — the ONLY authority on what the assistant may see and return. It:
 *   1. resolves the learner's OWN teaching session (throws TeachingSessionNotFoundError → 404 for a non-own/absent
 *      session — the assistant is IDOR-safe and can never read another learner's work);
 *   2. projects a MINIMAL, answer-key-free context from that already-learner-safe session view;
 *   3. delegates to the ASSISTANT_PORT (fail-closed default → UNAVAILABLE, so learning never depends on AI);
 *   4. bounds the provider's output length defensively (the provider is untrusted for size/format).
 *
 * It performs NO writes: no skill/mastery/acquisition/reward/roadmap/session mutation. The assistant is advisory —
 * authoritative state is only ever changed by the real teaching/review/repair flows.
 */
@Injectable()
export class AssistantService {
  constructor(
    @Inject(ASSISTANT_PORT) private readonly port: AssistantPort,
    private readonly teaching: TeachingSessionService,
  ) {}

  async askForTeachingSession(userId: string, sessionId: string, task: AssistantTask, question: string | null, language: AssistantLanguage): Promise<AssistantResult> {
    // Ownership + existence gate. Reusing getSession means the assistant's entire visible surface is exactly the
    // learner's own answer-key-free session view — nothing more can leak than the learner already sees.
    const session = await this.teaching.getSession(userId, sessionId);
    const context = this.safeContext(session);
    const trimmedQuestion = task === 'QUESTION' ? this.boundQuestion(question) : null;

    const result = await this.askProvider({ task, question: trimmedQuestion, context, language });
    return this.boundResult(result);
  }

  /** The provider is untrusted for reliability: any throw degrades to UNAVAILABLE so a failing/absent AI never 500s the learner. */
  private async askProvider(request: Parameters<AssistantPort['ask']>[0]): Promise<AssistantResult> {
    try {
      return await this.port.ask(request);
    } catch {
      return { status: 'UNAVAILABLE', message: null };
    }
  }

  /** A strict subset of the learner's own view: title/outcome + the stage they're working, plus a mistake flag. */
  private safeContext(session: TeachingSessionView): AssistantContext {
    const stage = this.focusStage(session);
    return {
      pointTitle: session.title,
      learningOutcome: this.outcomeText(session.learningOutcome),
      stageType: stage?.stageType ?? null,
      stageTitle: stage?.title ?? null,
      stageDescription: stage?.description ?? null,
      hasRecentMistake: session.stages.some((s) => s.activities.some((a) => a.lastResult !== null && !a.lastResult.isCorrect)),
    };
  }

  /** The stage the learner is stuck on: first with an unattempted/incorrect objective activity, else the first stage. */
  private focusStage(session: TeachingSessionView): TeachingStageView | null {
    const ordered = [...session.stages].sort((a, b) => a.position - b.position);
    const stuck = ordered.find((s) => s.activities.some((a) => a.kind === 'OBJECTIVE' && (!a.attempted || (a.lastResult !== null && !a.lastResult.isCorrect))));
    return stuck ?? ordered[0] ?? null;
  }

  /** Learner-facing outcome is JSON; only a plain-string outcome is forwarded (never a raw object — minimal + safe). */
  private outcomeText(outcome: Prisma.JsonValue | null): string | null {
    return typeof outcome === 'string' ? outcome : null;
  }

  private boundQuestion(question: string | null): string | null {
    const trimmed = (question ?? '').trim();
    return trimmed.length === 0 ? null : trimmed.slice(0, MAX_QUESTION_CHARS);
  }

  private boundResult(result: AssistantResult): AssistantResult {
    if (result.status !== 'ANSWERED' || result.message === null) return { status: result.status, message: null };
    return { status: 'ANSWERED', message: result.message.slice(0, MAX_MESSAGE_CHARS) };
  }
}
