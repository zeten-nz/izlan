import { Module } from '@nestjs/common';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminUsersRepository } from './admin-users.repository';

/**
 * Admin Users & Access — READ slice (Phase 07C1). Dedicated module (kept out of the auth-oriented UsersService).
 * PrismaService is global (DatabaseModule @Global); AuthGuard + PermissionsGuard are global APP_GUARDs, so no extra
 * imports are required. Later 07C slices add mutation services here.
 */
@Module({
  controllers: [AdminUsersController],
  providers: [AdminUsersService, AdminUsersRepository],
})
export class AdminUsersModule {}
