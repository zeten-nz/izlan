import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, ServiceUnavailableException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthConfig } from '../../config/env.validation';
import { OtpService } from '../otp/otp.service';
import { OtpPurpose } from '../otp/otp-purpose';
import { SessionsService } from '../sessions/sessions.service';
import { AccessTokenService } from '../access-token/access-token.service';
import { AuthCredentialService } from '../password/auth-credential.service';
import { assertPasswordPolicy } from '../password/password-policy';
import { UsersService } from '../../users/users.service';
import { normalizeUzPhone } from '../../users/phone.util';
import { maskPhone } from '../../security/phone-mask.util';
import { SecurityEventsService, SecurityEventType } from '../../security/security-events.service';
import { InMemoryAuthRateLimiter } from '../rate-limit/auth-rate-limiter';
import { SMS_PORT, SmsPort } from '../../sms/sms.port';
import { AuthRateLimitError, InvalidCredentialsError, OtpRateLimitError } from '../../common/errors';
import { LoginDto, RegisterDto, RequestOtpDto, ResetPasswordDto } from './dto';
import { Public, CurrentPrincipal } from './decorators';
import type { AuthPrincipal } from './principal';
import { setRefreshCookie, clearRefreshCookie, readRefreshCookie } from './cookie.util';
import { enforceRefreshCsrf } from './csrf';

const HOUR_MS = 3_600_000;

@Controller('auth')
export class AuthController {
  private readonly auth: AuthConfig;
  private readonly corsOrigins: readonly string[];
  private readonly cookieMaxAge: number; // refresh cookie umri = session absolute ttl (soniya)

  constructor(
    config: ConfigService,
    private readonly otp: OtpService,
    private readonly sessions: SessionsService,
    private readonly accessToken: AccessTokenService,
    private readonly credentials: AuthCredentialService,
    private readonly users: UsersService,
    private readonly securityEvents: SecurityEventsService,
    private readonly rateLimiter: InMemoryAuthRateLimiter,
    @Inject(SMS_PORT) private readonly sms: SmsPort,
  ) {
    this.auth = config.getOrThrow<AuthConfig>('auth');
    this.corsOrigins = config.getOrThrow<string[]>('corsOrigins');
    this.cookieMaxAge = this.auth.sessionAbsoluteTtlDays * 86_400;
  }

  private issueSession(reply: FastifyReply, refreshToken: string): void {
    setRefreshCookie(reply, refreshToken, this.auth.cookieSecure, this.cookieMaxAge);
    void reply.header('Cache-Control', 'no-store');
  }

  // ── POST /api/auth/login (phone + password — PRIMARY login, TD-252) ──
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const ip = req.ip;
    // Password-login protection by IP + canonical phone (reuse the shared limiter; emit a security event on trip).
    let phoneKey = 'invalid';
    try {
      phoneKey = normalizeUzPhone(dto.phone);
    } catch {
      /* keep 'invalid' — still rate-limited, still generic failure */
    }
    if (
      !this.rateLimiter.tryConsume(`login:ip:${ip}`, this.auth.loginIpHourlyLimit, HOUR_MS) ||
      !this.rateLimiter.tryConsume(`login:phone:${phoneKey}`, this.auth.loginPhoneHourlyLimit, HOUR_MS)
    ) {
      await this.securityEvents.record({ type: SecurityEventType.RATE_LIMIT_TRIGGERED, ip, metadata: { scope: 'password_login', phone: maskPhone(phoneKey) } });
      throw new AuthRateLimitError('login rate limit reached');
    }

    const user = await this.credentials.verifyCredentials(dto.phone, dto.password);
    if (!user) {
      // Unknown phone / no credential / wrong password → ONE generic 401 (no enumeration, §7).
      await this.securityEvents.record({ type: SecurityEventType.PASSWORD_LOGIN_FAILED, ip, metadata: { phone: maskPhone(phoneKey) } });
      throw new InvalidCredentialsError('invalid credentials');
    }

    await this.users.assertAuthAllowed(user.id); // SUSPENDED/DEACTIVATED → 403 (only after a correct password)

    const session = await this.sessions.createSession({ userId: user.id, platform: 'web' });
    const access = this.accessToken.issueAccessToken(user.id, session.sessionId);
    this.issueSession(reply, session.refreshToken);
    await this.users.recordLogin(user.id);
    await this.securityEvents.record({ type: SecurityEventType.PASSWORD_LOGIN_SUCCESS, userId: user.id, sessionId: session.sessionId, ip });

    const bootstrap = await this.users.getAuthBootstrap(user.id);
    return { accessToken: access.token, tokenType: 'Bearer', expiresIn: access.expiresIn, user: bootstrap };
  }

  // ── POST /api/auth/otp/request (phone verification for REGISTRATION / PASSWORD_RESET — NOT login) ──
  @Public()
  @Post('otp/request')
  @HttpCode(202)
  async requestOtp(@Body() dto: RequestOtpDto, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const ip = req.ip;
    const purpose = dto.purpose ?? OtpPurpose.REGISTRATION;
    // Per-IP hourly limit (§43). request.ip — trustProxy policy 1.4A authority.
    if (!this.rateLimiter.tryConsume(`otp:${ip}`, this.auth.otpIpHourlyLimit, HOUR_MS)) {
      await this.securityEvents.record({ type: SecurityEventType.RATE_LIMIT_TRIGGERED, ip, metadata: { scope: 'otp_ip' } });
      throw new OtpRateLimitError('otp ip limit reached');
    }

    // Enumeration-safe: account lookup YO'Q (§22). Purpose does not reveal whether the phone exists.
    const issued = await this.otp.issueChallenge({ phone: dto.phone, purpose, ip });
    if (purpose === OtpPurpose.PASSWORD_RESET) {
      await this.securityEvents.record({ type: SecurityEventType.PASSWORD_RESET_REQUESTED, ip, metadata: { phone: maskPhone(issued.canonicalPhone) } });
    }

    const result = await this.sms.sendOtp({ canonicalPhone: issued.canonicalPhone, code: issued.code, purpose });
    if (result !== 'SENT') {
      await this.otp.invalidateChallenge(issued.challengeId);
      throw new ServiceUnavailableException({ statusCode: 503, code: 'AUTH_SMS_UNAVAILABLE', message: 'could not send verification code' });
    }

    void reply.header('Cache-Control', 'no-store');
    return { challengeId: issued.challengeId, expiresIn: this.auth.otpTtlSeconds, resendAfter: this.auth.otpResendCooldownSeconds };
  }

  // ── POST /api/auth/register (verified REGISTRATION OTP + chosen password → account + session) ──
  @Public()
  @Post('register')
  @HttpCode(201)
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) reply: FastifyReply) {
    assertPasswordPolicy(dto.password); // BEFORE consuming the OTP — a bad password must not waste the challenge
    const { canonicalPhone } = await this.otp.verifyChallenge({ challengeId: dto.challengeId, purpose: OtpPurpose.REGISTRATION, code: dto.code });

    // Atomic User + Profile + LEARNER + PasswordCredential. Duplicate phone → 409 (no second account, §10).
    const user = await this.credentials.registerWithPassword(canonicalPhone, dto.password);
    await this.securityEvents.record({ type: SecurityEventType.REGISTRATION_SUCCESS, userId: user.id });

    const session = await this.sessions.createSession({ userId: user.id, platform: 'web' });
    const access = this.accessToken.issueAccessToken(user.id, session.sessionId);
    this.issueSession(reply, session.refreshToken);
    await this.users.recordLogin(user.id);

    const bootstrap = await this.users.getAuthBootstrap(user.id);
    return { accessToken: access.token, tokenType: 'Bearer', expiresIn: access.expiresIn, user: bootstrap };
  }

  // ── POST /api/auth/password/reset (verified PASSWORD_RESET OTP + new password; revokes sessions) ──
  @Public()
  @Post('password/reset')
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    assertPasswordPolicy(dto.password);
    const { canonicalPhone } = await this.otp.verifyChallenge({ challengeId: dto.challengeId, purpose: OtpPurpose.PASSWORD_RESET, code: dto.code });

    const result = await this.credentials.resetPassword(canonicalPhone, dto.password);
    if (result) {
      // A stolen refresh session must NOT survive a password reset (§11/23).
      await this.sessions.revokeAllUserSessions(result.userId, 'password_reset');
      await this.securityEvents.record({ type: SecurityEventType.PASSWORD_RESET_SUCCESS, userId: result.userId });
    }
    // Generic response either way — never reveal whether the phone had an account.
    return { status: 'ok' };
  }

  // ── POST /api/auth/refresh (cookie + CSRF; access JWT talab qilinmaydi) ──
  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    enforceRefreshCsrf(req.headers, this.corsOrigins); // CsrfRejectedError → 403

    const token = readRefreshCookie(req.headers.cookie);
    if (!token) throw new HttpException({ statusCode: 401, code: 'AUTH_UNAUTHORIZED', message: 'unauthorized' }, 401);

    const rotated = await this.sessions.rotateRefreshToken(token); // reuse/invalid → domain error → 401
    const access = this.accessToken.issueAccessToken(rotated.userId, rotated.sessionId);

    setRefreshCookie(reply, rotated.refreshToken, this.auth.cookieSecure, this.cookieMaxAge);
    void reply.header('Cache-Control', 'no-store');
    return { accessToken: access.token, tokenType: 'Bearer', expiresIn: access.expiresIn };
  }

  // ── POST /api/auth/logout (Bearer required) ──
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentPrincipal() principal: AuthPrincipal, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.sessions.revokeSession(principal.sessionId, 'logout'); // idempotent
    clearRefreshCookie(reply, this.auth.cookieSecure);
    void reply.header('Cache-Control', 'no-store');
  }

  // ── POST /api/auth/logout-all (Bearer required) ──
  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(@CurrentPrincipal() principal: AuthPrincipal, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.sessions.revokeAllUserSessions(principal.userId, 'logout_all');
    clearRefreshCookie(reply, this.auth.cookieSecure);
    void reply.header('Cache-Control', 'no-store');
  }

  // ── GET /api/auth/me (Bearer + live-check, §12/39) ──
  @Get('me')
  async me(@CurrentPrincipal() principal: AuthPrincipal) {
    await this.sessions.assertSessionActive(principal.sessionId); // revoked/expired → 401
    await this.users.assertAuthAllowed(principal.userId); // SUSPENDED/DEACTIVATED → 403
    return this.users.getAuthBootstrap(principal.userId);
  }
}
