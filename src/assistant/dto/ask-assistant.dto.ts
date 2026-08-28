import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AssistantLanguage, AssistantTask } from '../assistant.port';

const TASKS: readonly AssistantTask[] = ['EXPLAIN_DIFFERENTLY', 'ANOTHER_EXAMPLE', 'WHY_WRONG', 'SIMPLIFY', 'HINT', 'QUESTION'];
const LANGUAGES: readonly AssistantLanguage[] = ['uz', 'ru', 'en'];

/**
 * POST /v2/assistant/teaching-sessions/:sessionId/ask.
 *
 * `task` is a closed enum (server owns the intent catalog — no free-form provider prompt from the client).
 * `question` is optional learner free text (only meaningful for QUESTION), length-bounded here and re-bounded in the
 * service. `language` selects the reply language. forbidNonWhitelisted rejects any injected field (e.g. answerKey).
 */
export class AskAssistantDto {
  @IsIn(TASKS)
  task!: AssistantTask;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  question?: string;

  @IsOptional()
  @IsIn(LANGUAGES)
  language?: AssistantLanguage;
}
