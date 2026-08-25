import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { RequirePermissions } from '../auth/http/decorators';
import { USERS_READ } from './admin-users.constants';
import { AdminUsersService } from './admin-users.service';
import { ListUsersQueryDto } from './dto/list-users-query.dto';

/**
 * Admin Users READ surface (Phase 07C1). Global AuthGuard + PermissionsGuard; `users.read` required — authority is
 * permission-code based (no ADMIN role-name bypass). READ-ONLY: there is no status/role/session mutation here (later
 * 07C slices). Responses are safe projections only — never a password hash, OTP, DOB, or session/refresh secret.
 */
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly service: AdminUsersService) {}

  /** GET /api/admin/users — bounded keyset list with safe filters (q / status / role) + safe projection. */
  @Get()
  @RequirePermissions(USERS_READ)
  list(@Query() query: ListUsersQueryDto) {
    return this.service.list(query);
  }

  /** GET /api/admin/users/:userId — safe user detail (roles, assigned subjects, active-session count). 404 if unknown. */
  @Get(':userId')
  @RequirePermissions(USERS_READ)
  detail(@Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.service.detail(userId);
  }
}
