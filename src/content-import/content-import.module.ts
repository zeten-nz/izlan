import { Module } from '@nestjs/common';
import { ContentAuthoringModule } from '../content-authoring/content-authoring.module';
import { ImportController } from './http/import.controller';
import { ImportService } from './import.service';
import { ImportRepository } from './import.repository';

/**
 * ContentImportModule (Phase 2.2D, TD-253). Topic-scoped JSON bulk import. Reuses ContentAuthoringModule's exported
 * authoring primitives (subject scope, entity repos, DAG writer, audit) — no duplicated business validation. Global
 * AuthGuard/PermissionsGuard (AuthModule) protect the controller; PrismaService is global.
 */
@Module({
  imports: [ContentAuthoringModule],
  controllers: [ImportController],
  providers: [ImportService, ImportRepository],
})
export class ContentImportModule {}
