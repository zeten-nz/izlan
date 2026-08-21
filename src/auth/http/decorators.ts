import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthPrincipal } from './principal';

/** @Public() — global AuthGuard'ni chetlab o'tadi (health/otp/refresh). */
export const IS_PUBLIC_KEY = 'auth:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** @RequirePermissions(...) — typed permission kodlar (§14). Default semantika: ALL required (§15). */
export const PERMISSIONS_KEY = 'auth:requiredPermissions';
export const RequirePermissions = (...codes: string[]) => SetMetadata(PERMISSIONS_KEY, codes);

/** @CurrentPrincipal() — guard biriktirgan principal (request.user as any YO'Q, §13). */
export const CurrentPrincipal = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthPrincipal => {
  const req = ctx.switchToHttp().getRequest<{ authPrincipal?: AuthPrincipal }>();
  if (!req.authPrincipal) throw new Error('AuthPrincipal missing — AuthGuard must run first');
  return req.authPrincipal;
});
