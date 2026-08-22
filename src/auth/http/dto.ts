import { IsString, IsNotEmpty, MaxLength, IsUUID, Matches, IsOptional, IsIn } from 'class-validator';
import { PUBLIC_OTP_PURPOSES } from '../otp/otp-purpose';

/** POST /auth/otp/request — phone verification for REGISTRATION or PASSWORD_RESET (default REGISTRATION). */
export class RequestOtpDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  phone!: string;

  @IsOptional()
  @IsIn(PUBLIC_OTP_PURPOSES as string[])
  purpose?: string;
}

/** POST /auth/login — primary phone + password login. Password length is enforced by the policy, not here. */
export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  phone!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  password!: string;
}

/** POST /auth/register — verified-phone registration (REGISTRATION OTP + chosen password). */
export class RegisterDto {
  @IsUUID()
  challengeId!: string;

  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  password!: string;
}

/** POST /auth/password/reset — verified-phone recovery (PASSWORD_RESET OTP + new password). */
export class ResetPasswordDto {
  @IsUUID()
  challengeId!: string;

  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  password!: string;
}
