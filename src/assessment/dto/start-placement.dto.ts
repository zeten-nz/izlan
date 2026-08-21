import { IsUUID } from 'class-validator';

/**
 * POST /api/assessments/placement/start — starts from the learner's OWN LearningIntent (§5).
 * The server resolves subject/track/definition/version; the client never sends any of those,
 * and never a userId or definitionVersionId (§5/8).
 */
export class StartPlacementDto {
  @IsUUID()
  learningIntentId!: string;
}
