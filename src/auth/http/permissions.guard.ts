import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationService } from '../../authorization/authorization.service';
import { PERMISSIONS_KEY } from './decorators';
import type { AuthPrincipal } from './principal';

/**
 * PermissionsGuard (§15). Server-side effective permissions; ALL required (default).
 * No ADMIN bypass, no role-name hardcode, no cache. AuthGuard oldin ishlaydi (principal talab qilinadi).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authz: AuthorizationService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required || required.length === 0) return true; // metadata yo'q → permission tekshiruvi yo'q

    const req = ctx.switchToHttp().getRequest<{ authPrincipal?: AuthPrincipal }>();
    const principal = req.authPrincipal;
    if (!principal) throw new ForbiddenException(); // AuthGuard ishlamagan / @Public bilan noto'g'ri kombinatsiya

    const ok = await this.authz.hasAllPermissions(principal.userId, required);
    if (!ok) throw new ForbiddenException();
    return true;
  }
}
