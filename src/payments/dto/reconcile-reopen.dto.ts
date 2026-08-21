import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { RECONCILE_MAX_LIMIT } from '../finalization-recovery.constants';

/** Bounded reopen-reconcile input (§24) — only a limit; no payment/status/force authority. */
export class ReconcileReopenDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(RECONCILE_MAX_LIMIT)
  limit?: number;
}

/** Read-only reopen-backlog query (§23) — bounded limit. */
export class ReopenBacklogQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(RECONCILE_MAX_LIMIT)
  limit?: number;
}
