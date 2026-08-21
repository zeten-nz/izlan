import { IsString, IsNotEmpty, MaxLength, IsUUID, Matches } from 'class-validator';

/** POST /auth/otp/request — purpose client tomonidan berilmaydi (LOGIN only, §18). */
export class RequestOtpDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  phone!: string;
}

/** POST /auth/otp/verify — phone qayta talab qilinmaydi (challenge canonical phone/purpose'ni saqlaydi, §23). */
export class VerifyOtpDto {
  @IsUUID()
  challengeId!: string;

  // 6 raqamli STRING — number'ga aylantirilmaydi (leading zero saqlanadi, §45).
  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code!: string;
}
