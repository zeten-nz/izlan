import { Injectable } from '@nestjs/common';
import { AssistantPort, AssistantResult } from '../assistant.port';

/**
 * Production default (fail-closed, SMS UnavailableSmsAdapter bilan bir xil). Production-safe AI provider
 * TANLANMAGAN → har doim UNAVAILABLE. HECH NARSA log qilinmaydi/saqlanmaydi/mutatsiya qilinmaydi.
 *
 * With this adapter the daily learning loop is fully functional without any AI: the UI degrades gracefully
 * (the assistant panel shows an unavailable state) and the learner still learns/reviews/repairs/finishes.
 */
@Injectable()
export class UnavailableAssistantAdapter implements AssistantPort {
  async ask(): Promise<AssistantResult> {
    return { status: 'UNAVAILABLE', message: null };
  }
}
