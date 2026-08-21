import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { CmsSessionController } from './http/cms-session.controller';
import { SubjectsController } from './http/subjects.controller';
import { HierarchyController } from './http/hierarchy.controller';
import { LessonsController } from './http/lessons.controller';
import { RevisionsController } from './http/revisions.controller';
import { ActivitiesController } from './http/activities.controller';
import { SkillsController } from './http/skills.controller';
import { SkillMappingsController } from './http/skill-mappings.controller';
import { PrerequisitesController } from './http/prerequisites.controller';
import { HierarchyPublishController } from './http/hierarchy-publish.controller';
import { PublicationController } from './http/publication.controller';
import { HierarchyPublishService } from './publish/hierarchy-publish.service';
import { PublicationService } from './publish/publication.service';
import { PublicationReadinessService } from './publish/publication-readiness.service';
import { PublishRepository } from './publish/publish.repository';
import { SubjectService } from './subject.service';
import { HierarchyService } from './hierarchy.service';
import { RevisionService } from './revision.service';
import { ActivityService } from './activity.service';
import { SkillService } from './skill.service';
import { SkillMappingService } from './skill-mapping.service';
import { PrerequisiteService } from './prerequisite.service';
import { SubjectScopeService } from './subject-scope.service';
import { SubjectRepository } from './subject.repository';
import { HierarchyRepository } from './hierarchy.repository';
import { RevisionRepository } from './revision.repository';
import { ActivityRepository } from './activity.repository';
import { SkillRepository } from './skill.repository';
import { MappingRepository } from './mapping.repository';
import { PrerequisiteRepository } from './prerequisite.repository';
import { ContentAuditRepository } from './content-audit.repository';
import './content-authoring.constants'; // side-effect: register permission codes in the app registry

/**
 * ContentAuthoringModule (Phase 2.2A-1). Staff-only content authoring: authorization + subject scope + hierarchy
 * + logical Lesson. Global AuthGuard/PermissionsGuard (AuthModule) protect the controllers; PrismaService is global.
 * No LessonRevision/Activity/prerequisite/publish authoring here (deferred to 2.2A-2 / 2.2A-3).
 */
@Module({
  imports: [AuthorizationModule], // AuthorizationService for the CMS capability endpoint (Phase 2.2C)
  controllers: [
    CmsSessionController,
    SubjectsController, HierarchyController, LessonsController, RevisionsController, ActivitiesController,
    SkillsController, SkillMappingsController, PrerequisitesController, HierarchyPublishController, PublicationController,
  ],
  providers: [
    SubjectService, HierarchyService, RevisionService, ActivityService, SkillService, SkillMappingService, PrerequisiteService, SubjectScopeService,
    HierarchyPublishService, PublicationService, PublicationReadinessService,
    SubjectRepository, HierarchyRepository, RevisionRepository, ActivityRepository, SkillRepository, MappingRepository, PrerequisiteRepository, ContentAuditRepository, PublishRepository,
  ],
})
export class ContentAuthoringModule {}
