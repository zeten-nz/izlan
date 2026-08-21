import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { UsersModule } from '../users/users.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { SecurityModule } from '../security/security.module';
import { SmsModule } from '../sms/sms.module';
import { OtpCodeService } from './otp/otp-code.service';
import { OtpRepository } from './otp/otp.repository';
import { OtpService } from './otp/otp.service';
import { AuthSessionRepository } from './sessions/auth-session.repository';
import { RefreshTokenRepository } from './sessions/refresh-token.repository';
import { SessionsService } from './sessions/sessions.service';
import { AccessTokenService } from './access-token/access-token.service';
import { AuthController } from './http/auth.controller';
import { AuthGuard } from './http/auth.guard';
import { PermissionsGuard } from './http/permissions.guard';

/**
 * AuthModule — core primitives (1.4B) + HTTP adapter (1.4C).
 * Global guard'lar (§16): AuthGuard (Bearer JWT) → PermissionsGuard. @Public() chetlab o'tadi.
 * Guard tartibi APP_GUARD ro'yxatidagi tartib bo'yicha (AuthGuard oldin).
 */
@Module({
  imports: [UsersModule, AuthorizationModule, SecurityModule, SmsModule],
  controllers: [AuthController],
  providers: [
    OtpCodeService,
    OtpRepository,
    OtpService,
    AuthSessionRepository,
    RefreshTokenRepository,
    SessionsService,
    AccessTokenService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [OtpService, SessionsService, AccessTokenService],
})
export class AuthModule {}
