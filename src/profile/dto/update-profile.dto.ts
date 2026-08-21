import { IsOptional, IsString, MinLength, MaxLength, Matches, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';

/** UI locale registry (§15). UI tili ≠ learning subject tili. Product'da to'liq final emas — minimal. */
export const ALLOWED_UI_LOCALES = ['uz', 'en'] as const;

/**
 * PATCH /api/profile/me — partial self-edit (§16/17/18).
 * Faqat self-editable fieldlar; status/role/phone/onboardingCompletedAt/id/permissions QABUL QILINMAYDI
 * (ValidationPipe whitelist + forbidNonWhitelisted). Required profile fieldlar uchun null QABUL QILINMAYDI.
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1, { message: 'displayName must not be empty' })
  @MaxLength(100, { message: 'displayName too long' })
  // Unicode ruxsat (uz/ru/...); faqat control belgilar (\p{Cc}) rad etiladi (§11/12).
  @Matches(/^[^\p{Cc}]+$/u, { message: 'displayName contains control characters' })
  displayName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateOfBirth must be YYYY-MM-DD' })
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsIn(ALLOWED_UI_LOCALES)
  preferredLanguage?: string;
}
