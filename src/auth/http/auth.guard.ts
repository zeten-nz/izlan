import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessTokenInvalidError } from '../../common/errors';
import { AccessTokenService } from '../access-token/access-token.service';
import { IS_PUBLIC_KEY } from './decorators';
import type { AuthPrincipal } from './principal';

/**
 * Global AuthGuard (§11/16). Bearer access JWT verify → principal (baseline).
 * Passport YO'Q. @Public() routelar chetlab o'tiladi. Sensitive live-check (session/account)
 * controller'da explicit (§12) — bu yerda faqat token validligi.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessToken: AccessTokenService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; authPrincipal?: AuthPrincipal }>();
    const header = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
      throw new AccessTokenInvalidError('missing bearer token');
    }
    const token = header.slice('Bearer '.length).trim();
    // verifyAccessToken refresh/opaque tokenni ham rad etadi (RS256 JWT emas → invalid).
    req.authPrincipal = this.accessToken.verifyAccessToken(token);
    return true;
  }
}
