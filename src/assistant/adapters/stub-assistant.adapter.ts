import { Injectable } from '@nestjs/common';
import { AssistantLanguage, AssistantPort, AssistantRequest, AssistantResult, AssistantTask } from '../assistant.port';

/**
 * DEVELOPMENT/TEST-ONLY assistant adapter (ConsoleSmsAdapter bilan bir xil qoida). Selected via
 * ASSISTANT_DRIVER=stub; FORBIDDEN in production (the AssistantModule factory throws at startup). It is NOT a real
 * AI provider — it is a deterministic test double that returns fixed pedagogical scaffolding built ONLY from the
 * already-learner-safe context. It has no model, no network, no secrets.
 *
 * Structural safety: it receives an AssistantContext that never contains an answerKey/score/token, so it cannot
 * reveal one. It never mutates any state. WHY_WRONG is DECLINED until there is a real incorrect submission, so the
 * assistant never fabricates a mistake or leaks the answer before submission.
 */
@Injectable()
export class StubAssistantAdapter implements AssistantPort {
  async ask(request: AssistantRequest): Promise<AssistantResult> {
    const { task, context, language } = request;
    if (task === 'WHY_WRONG' && !context.hasRecentMistake) {
      return { status: 'DECLINED', message: null };
    }
    const topic = context.stageTitle ?? context.pointTitle;
    const focus = context.stageDescription ?? context.learningOutcome ?? context.pointTitle;
    return { status: 'ANSWERED', message: this.scaffold(task, topic, focus, language) };
  }

  private scaffold(task: AssistantTask, topic: string, focus: string, language: AssistantLanguage): string {
    const t = TEMPLATES[language] ?? TEMPLATES.uz;
    return t[task](topic, focus);
  }
}

type Template = Record<AssistantTask, (topic: string, focus: string) => string>;

/**
 * Fixed, answer-free scaffolds. They coach the learner toward the concept ("focus") without ever stating a correct
 * answer — deliberately generic so no test depends on a leaked key. Producer text only; never authoritative.
 */
const TEMPLATES: Record<AssistantLanguage, Template> = {
  uz: {
    EXPLAIN_DIFFERENTLY: (topic, focus) => `Keling, "${topic}"ni boshqacha tushuntiraman. Asosiy g'oya: ${focus}. Har bir bo'lakni alohida ko'rib chiqing.`,
    ANOTHER_EXAMPLE: (topic) => `"${topic}" bo'yicha yana bir misolni o'ylab ko'ring va o'sha qoidani qo'llang. Javobni o'zingiz tuzishga harakat qiling.`,
    WHY_WRONG: (topic, focus) => `Oxirgi urinish to'g'ri chiqmadi. "${topic}"da e'tibor bering: ${focus}. Qadamlarni qayta tekshiring.`,
    SIMPLIFY: (topic, focus) => `Soddaroq qilib: ${focus}. Avval "${topic}"ning eng oddiy holatini mustahkamlang.`,
    HINT: (topic, focus) => `Ishora: ${focus}. Javobni bermayman — "${topic}"ni o'zingiz yeching.`,
    QUESTION: (topic, focus) => `Savolingiz bo'yicha: ${focus}. "${topic}"ga bog'lab o'ylab ko'ring.`,
  },
  ru: {
    EXPLAIN_DIFFERENTLY: (topic, focus) => `Объясню "${topic}" иначе. Главная идея: ${focus}. Разберите каждую часть отдельно.`,
    ANOTHER_EXAMPLE: (topic) => `Придумайте ещё один пример по теме "${topic}" и примените то же правило. Попробуйте составить ответ сами.`,
    WHY_WRONG: (topic, focus) => `Последняя попытка неверна. В "${topic}" обратите внимание: ${focus}. Перепроверьте шаги.`,
    SIMPLIFY: (topic, focus) => `Проще говоря: ${focus}. Сначала закрепите самый простой случай "${topic}".`,
    HINT: (topic, focus) => `Подсказка: ${focus}. Ответ не даю — решите "${topic}" сами.`,
    QUESTION: (topic, focus) => `По вашему вопросу: ${focus}. Свяжите это с "${topic}".`,
  },
  en: {
    EXPLAIN_DIFFERENTLY: (topic, focus) => `Let me explain "${topic}" another way. The core idea: ${focus}. Work through each part on its own.`,
    ANOTHER_EXAMPLE: (topic) => `Think of one more example for "${topic}" and apply the same rule. Try to build the answer yourself.`,
    WHY_WRONG: (topic, focus) => `Your last attempt wasn't correct. In "${topic}", focus on: ${focus}. Re-check your steps.`,
    SIMPLIFY: (topic, focus) => `More simply: ${focus}. First lock in the simplest case of "${topic}".`,
    HINT: (topic, focus) => `Hint: ${focus}. I won't give the answer — solve "${topic}" yourself.`,
    QUESTION: (topic, focus) => `On your question: ${focus}. Try to connect it back to "${topic}".`,
  },
};
