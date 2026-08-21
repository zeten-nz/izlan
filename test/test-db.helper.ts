import { PrismaService } from '../src/database/prisma.service';

/** Destructive op oldidan test DB identity guard (§44) — noaniqlik bo'lsa FAIL, o'chirmaydi. */
export async function assertTestDatabase(prisma: PrismaService): Promise<void> {
  const rows = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() as db`;
  const db = rows[0]?.db;
  if (db !== 'izlan_test' || process.env.NODE_ENV !== 'test') {
    throw new Error(`Refusing destructive cleanup: database=${db}, NODE_ENV=${process.env.NODE_ENV}`);
  }
}

/**
 * Roadmap + content fixtures (Phase 1.6A). Child→parent; the Lesson↔LessonRevision circular pointer
 * (published_revision_id) is broken first by nulling it. Run BEFORE cleanupAssessmentTables (skills).
 */
export async function cleanupRoadmapContent(prisma: PrismaService): Promise<void> {
  await assertTestDatabase(prisma);
  await prisma.roadmapItem.deleteMany();
  await prisma.roadmapChange.deleteMany();
  await prisma.learnerRecommendation.deleteMany();
  await prisma.learnerRoadmap.deleteMany();
  await prisma.learnerLessonCompletion.deleteMany();
  await prisma.learnerLessonProgress.deleteMany();
  await prisma.lessonPrerequisite.deleteMany();
  await prisma.lessonSkill.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.lesson.updateMany({ data: { publishedRevisionId: null } }); // break Lesson↔Revision cycle
  await prisma.lessonRevision.deleteMany();
  await prisma.lesson.deleteMany();
  await prisma.topic.deleteMany();
  await prisma.module.deleteMany();
  await prisma.level.deleteMany();
}

/**
 * Placement assessment fixtures (Phase 1.5B). Child→parent order; the AssessmentDefinition↔Version
 * circular pointer (current_version_id) is broken first by nulling it. Skills included (item→skill FK).
 */
export async function cleanupAssessmentTables(prisma: PrismaService): Promise<void> {
  await assertTestDatabase(prisma);
  // Advisory signals first — learner_signal.subject_id is RESTRICT; must clear before subject deletion (Phase 1.8B/1.8C).
  await prisma.learnerSignal.deleteMany();
  // Derived state first (references skill + user; attemptId is a plain scalar) — Phase 1.5C.
  await prisma.skillMeasurement.deleteMany();
  await prisma.learnerSkillState.deleteMany();
  await prisma.aiEvaluation.deleteMany();
  await prisma.assessmentResponse.deleteMany();
  await prisma.assessmentAttempt.deleteMany();
  await prisma.assessmentVersionItem.deleteMany();
  await prisma.assessmentItemMedia.deleteMany();
  await prisma.assessmentDefinition.updateMany({ data: { currentVersionId: null } }); // break circular FK
  await prisma.assessmentItem.deleteMany();
  await prisma.assessmentDefinitionVersion.deleteMany();
  await prisma.assessmentDefinition.deleteMany();
  await prisma.skill.deleteMany();
}

/** Faqat auth-related jadvallar (§45) — content/finance/community TEGILMAYDI. Roles saqlanadi (bootstrap qayta ishlaydi). */
export async function cleanupAuthTables(prisma: PrismaService): Promise<void> {
  await assertTestDatabase(prisma);
  await prisma.securityEvent.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.authSession.deleteMany();
  await prisma.otpChallenge.deleteMany();
  // XP tables reference user (RESTRICT) — clear before user deletion (Phase 2.0C-2 XpGrant, 2.0D XpBalance projection).
  await prisma.xpGrant.deleteMany();
  await prisma.xpBalance.deleteMany();
  // IZL wallet/reservation projections reference user (RESTRICT) — clear before user deletion (Phase 2.1B).
  await prisma.iZLReservation.deleteMany();
  await prisma.iZLWallet.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.userProfile.deleteMany();
  await prisma.user.deleteMany();
}
