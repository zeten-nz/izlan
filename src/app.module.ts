import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';
import { AuthorizationModule } from './authorization/authorization.module';
import { SecurityModule } from './security/security.module';
import { SmsModule } from './sms/sms.module';
import { AuthModule } from './auth/auth.module';
import { ProfileModule } from './profile/profile.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { AssessmentModule } from './assessment/assessment.module';
import { SkillProfileModule } from './skill-profile/skill-profile.module';
import { RoadmapModule } from './roadmap/roadmap.module';
import { DailyPlanModule } from './daily-plan/daily-plan.module';
import { LessonExecutionModule } from './lesson-execution/lesson-execution.module';
import { LearningProgressModule } from './learning-progress/learning-progress.module';
import { LearnerSignalsModule } from './learner-signals/learner-signals.module';
import { ReviewModule } from './review/review.module';
import { ReviewSessionModule } from './review-session/review-session.module';
import { DailyMissionModule } from './daily-mission/daily-mission.module';
import { XpModule } from './xp/xp.module';
import { FinanceModule } from './finance/finance.module';
import { PaymentsModule } from './payments/payments.module';
import { ContentAuthoringModule } from './content-authoring/content-authoring.module';
import { AssessmentAuthoringModule } from './assessment-authoring/assessment-authoring.module';
import { ContentImportModule } from './content-import/content-import.module';
import { MediaModule } from './media/media.module';
import { LearningCoreModule } from './learning-core/learning-core.module';
import { PlacementV2Module } from './placement-v2/placement-v2.module';
import { PointAuthoringModule } from './point-authoring/point-authoring.module';
import { DailyLearningModule } from './daily-learning/daily-learning.module';
import { AssistantModule } from './assistant/assistant.module';

/**
 * AppModule — foundational (Config/Database/Health) + auth core + learner flow (…/LearningProgress/
 * LearnerSignals/Review). LearningProgress is the single writer of LearnerSkillState; LearnerSignals owns
 * advisory signals; Review is a read-only candidate model derived from ACTIVE signals + encountered content.
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    HealthModule,
    UsersModule,
    AuthorizationModule,
    SecurityModule,
    SmsModule,
    AuthModule,
    ProfileModule,
    OnboardingModule,
    AssessmentModule,
    SkillProfileModule,
    RoadmapModule,
    DailyPlanModule,
    LessonExecutionModule,
    LearningProgressModule,
    LearnerSignalsModule,
    ReviewModule,
    ReviewSessionModule,
    DailyMissionModule,
    XpModule,
    FinanceModule,
    PaymentsModule,
    ContentAuthoringModule,
    AssessmentAuthoringModule,
    ContentImportModule,
    MediaModule,
    LearningCoreModule,
    PlacementV2Module,
    PointAuthoringModule,
    DailyLearningModule,
    AssistantModule,
  ],
})
export class AppModule {}
