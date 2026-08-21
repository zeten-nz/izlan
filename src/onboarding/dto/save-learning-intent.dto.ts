import { IsOptional, IsUUID } from 'class-validator';

/**
 * PUT /api/onboarding/learning-intent (§21 — bitta endpoint, resumable).
 * trackId optional: subject-only saqlanadi (resumability §5), keyin track qo'shiladi.
 * userId/status/createdAt/onboardingCompleted QABUL QILINMAYDI (whitelist).
 */
export class SaveLearningIntentDto {
  @IsUUID()
  subjectId!: string;

  @IsOptional()
  @IsUUID()
  trackId?: string;
}
