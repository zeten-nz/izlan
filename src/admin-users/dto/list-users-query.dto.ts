import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { UserStatus } from '@prisma/client';
import { LIST_ROLE_CODES, USERS_LIST_MAX_LIMIT, type ListRoleCode } from '../admin-users.constants';

/**
 * Admin user-list query (Phase 07C1). All params are optional; unknown params are rejected by the global
 * ValidationPipe (whitelist + forbidNonWhitelisted). `limit` is bounded; `status`/`role` accept only real enum values;
 * `cursor` is an opaque keyset token validated in the service.
 */
export class ListUsersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsIn(Object.values(UserStatus))
  status?: UserStatus;

  @IsOptional()
  @IsIn([...LIST_ROLE_CODES])
  role?: ListRoleCode;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(USERS_LIST_MAX_LIMIT)
  limit?: number;
}
