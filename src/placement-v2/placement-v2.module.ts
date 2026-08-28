import { Module } from '@nestjs/common';
import { SkillProfileModule } from '../skill-profile/skill-profile.module';
import { PlacementV2Repository } from './placement-v2.repository';
import { PlacementV2Service } from './placement-v2.service';
import { PlacementV2Controller } from './placement-v2.controller';

/**
 * Placement V2 — the decision + personalized-roadmap engine. Reuses the diagnostic evidence pipeline
 * (SkillProfileModule ensures DIAGNOSTIC SkillMeasurements are derived through the single-writer merge), then
 * writes the immutable PlacementDecision + validation lineage and generates the V2 RoadmapPoint projection.
 */
@Module({
  imports: [SkillProfileModule],
  controllers: [PlacementV2Controller],
  providers: [PlacementV2Repository, PlacementV2Service],
  exports: [PlacementV2Service],
})
export class PlacementV2Module {}
