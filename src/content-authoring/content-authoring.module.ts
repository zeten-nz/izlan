import { Module } from '@nestjs/common';
import { SubjectsController } from './http/subjects.controller';
import { HierarchyController } from './http/hierarchy.controller';
import { LessonsController } from './http/lessons.controller';
import { RevisionsController } from './http/revisions.controller';
import { ActivitiesController } from './http/activities.controller';
import { SubjectService } from './subject.service';
import { HierarchyService } from './hierarchy.service';
import { RevisionService } from './revision.service';
import { ActivityService } from './activity.service';
import { SubjectScopeService } from './subject-scope.service';
import { SubjectRepository } from './subject.repository';
import { HierarchyRepository } from './hierarchy.repository';
import { RevisionRepository } from './revision.repository';
import { ActivityRepository } from './activity.repository';
import { ContentAuditRepository } from './content-audit.repository';
import './content-authoring.constants'; // side-effect: register permission codes in the app registry

/**
 * ContentAuthoringModule (Phase 2.2A-1). Staff-only content authoring: authorization + subject scope + hierarchy
 * + logical Lesson. Global AuthGuard/PermissionsGuard (AuthModule) protect the controllers; PrismaService is global.
 * No LessonRevision/Activity/prerequisite/publish authoring here (deferred to 2.2A-2 / 2.2A-3).
 */
@Module({
  controllers: [SubjectsController, HierarchyController, LessonsController, RevisionsController, ActivitiesController],
  providers: [
    SubjectService, HierarchyService, RevisionService, ActivityService, SubjectScopeService,
    SubjectRepository, HierarchyRepository, RevisionRepository, ActivityRepository, ContentAuditRepository,
  ],
})
export class ContentAuthoringModule {}
