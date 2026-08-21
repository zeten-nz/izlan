import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { RECONCILE_MAX_LIMIT } from '../finalization-recovery.constants';

/** Bounded reconcile input (§6/§14) — only a limit; no payment/economic authority. */
export class ReconcileFinalizationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(RECONCILE_MAX_LIMIT)
  limit?: number;
}

/** Read-only backlog query (§13) — bounded limit. */
export class FinalizationBacklogQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(RECONCILE_MAX_LIMIT)
  limit?: number;
}
