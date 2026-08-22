import { Controller, Get } from '@nestjs/common';
import { CurrentPrincipal, RequirePermissions } from '../../auth/http/decorators';
import type { AuthPrincipal } from '../../auth/http/principal';
import { AuthorizationService } from '../../authorization/authorization.service';
import { CONTENT_AUTHOR, CONTENT_PUBLISH, CONTENT_SUBJECT_MANAGE } from '../content-authoring.constants';

/**
 * CMS capability/session endpoint (Phase 2.2C, TD-251). The frontend must NOT hard-code role names to decide which
 * actions to show; `/api/auth/me` intentionally exposes no permissions. This ONE narrow endpoint returns only
 * CMS-safe capability booleans derived from the actor's effective permission codes (no role names, no phone/DOB, no
 * unrelated permissions, no raw UserRole rows). `content.author` is required to reach it (the guard 403s otherwise —
 * so `author` is always true here). BACKEND remains the final authorization authority; these booleans drive UX only.
 */
@Controller('staff/content')
export class CmsSessionController {
  constructor(private readonly authz: AuthorizationService) {}

  @Get('session')
  @RequirePermissions(CONTENT_AUTHOR)
  async session(@CurrentPrincipal() principal: AuthPrincipal) {
    const perms = await this.authz.getEffectivePermissions(principal.userId);
    return {
      userId: principal.userId,
      capabilities: {
        author: perms.has(CONTENT_AUTHOR), // guaranteed true (guard), returned explicitly for a stable contract
        publish: perms.has(CONTENT_PUBLISH),
        subjectManage: perms.has(CONTENT_SUBJECT_MANAGE),
      },
    };
  }
}
