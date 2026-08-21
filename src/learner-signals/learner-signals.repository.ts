import { Injectable } from '@nestjs/common';
import { ActivityAttemptStatus, Prisma, SignalStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { OBJECTIVE_TYPES } from '../lesson-execution/completion/lesson-completion-eligibility';
import { ActivityOutcome, REPEATED_MISTAKE_SIGNAL_TYPE } from './repeated-mistake.detector';

const OBJECTIVE_TYPE_LIST = [...OBJECTIVE_TYPES];

/** Learner Signals persistence. Reads append-only ActivityAttempt evidence + content attribution; writes ONLY
 *  LearnerSignal (advisory). Never mutates ActivityAttempt / SkillMeasurement / LearnerSkillState / Roadmap. */
@Injectable()
export class LearnerSignalsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Signal-namespaced per (user, skill) serialization (§25/26). Distinct keyspace from the merge lock so
   *  signal evaluation and skill-state merge never block each other. Bound params; released at commit. */
  async advisoryLock(tx: Prisma.TransactionClient, userId: string, skillId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'sig:' + userId}), hashtext(${skillId}))`;
  }

  skillSubjectId(tx: Prisma.TransactionClient, skillId: string): Promise<string | null> {
    return tx.skill.findUnique({ where: { id: skillId }, select: { subjectId: true } }).then((s) => s?.subjectId ?? null);
  }

  /**
   * Eligible objective SUBMITTED attempts attributed to `skillId`, subject-scoped to the skill's Subject,
   * most-recent-first (§6/7/8/10). Attribution: ActivitySkill(skill) OR (no ActivitySkill at all → LessonSkill).
   */
  async eligibleAttemptsForSkill(tx: Prisma.TransactionClient, userId: string, skillId: string, subjectId: string): Promise<(ActivityOutcome & { activityId: string })[]> {
    const rows = await tx.activityAttempt.findMany({
      where: {
        userId,
        status: ActivityAttemptStatus.SUBMITTED,
        isCorrect: { not: null },
        activity: {
          type: { in: OBJECTIVE_TYPE_LIST },
          revision: { lesson: { topic: { module: { level: { track: { subjectId } } } } } }, // subject scope (§8)
          OR: [
            { skills: { some: { skillId } } }, // ActivitySkill authority (§7)
            { skills: { none: {} }, revision: { lesson: { skills: { some: { skillId } } } } }, // LessonSkill fallback
          ],
        },
      },
      select: { id: true, activityId: true, isCorrect: true },
      orderBy: [{ submittedAt: 'desc' }, { attemptNo: 'desc' }, { id: 'desc' }],
    });
    return rows.map((r) => ({ activityId: r.activityId, activityAttemptId: r.id, isCorrect: r.isCorrect === true }));
  }

  /** Active signal of a given type for a skill (evidenceRefs included for the review-basis check, §20). */
  findActiveSignal(tx: Prisma.TransactionClient, userId: string, skillId: string, type: string) {
    return tx.learnerSignal.findFirst({ where: { userId, skillId, type, status: SignalStatus.ACTIVE }, select: { id: true, evidenceRefs: true } });
  }

  createSignal(tx: Prisma.TransactionClient, data: { userId: string; subjectId: string; skillId: string; type: string; evidenceRefs: Prisma.InputJsonValue }) {
    return tx.learnerSignal.create({
      data: { userId: data.userId, subjectId: data.subjectId, skillId: data.skillId, type: data.type, status: SignalStatus.ACTIVE, evidenceRefs: data.evidenceRefs },
      select: { id: true },
    });
  }

  /** Current materialized Skill state (WEAK_SKILL / REVIEW_DUE authority, §4/14). */
  currentState(tx: Prisma.TransactionClient, userId: string, skillId: string) {
    return tx.learnerSkillState.findUnique({
      where: { userId_skillId: { userId, skillId } },
      select: { masteryScoreBp: true, confidenceBp: true, evidenceCount: true, lastMeasurementAt: true },
    });
  }

  /** Conditional terminal transition ACTIVE → RESOLVED (idempotent; never touches terminal rows, §16/20). */
  resolveSignal(tx: Prisma.TransactionClient, signalId: string, resolvedAt: Date) {
    return tx.learnerSignal.updateMany({ where: { id: signalId, status: SignalStatus.ACTIVE }, data: { status: SignalStatus.RESOLVED, resolvedAt } });
  }

  /** Raw attributed skills for a submitted Activity (subject scope applied later per-skill, §27). */
  async attributedSkillIdsForActivity(activityId: string): Promise<string[]> {
    const activity = await this.prisma.activity.findUnique({
      where: { id: activityId },
      select: { skills: { select: { skillId: true } }, revision: { select: { lesson: { select: { skills: { select: { skillId: true } } } } } } },
    });
    if (!activity) return [];
    const act = activity.skills.map((s) => s.skillId);
    return act.length ? act : activity.revision.lesson.skills.map((s) => s.skillId);
  }

  getSubject(subjectId: string) {
    return this.prisma.subject.findUnique({ where: { id: subjectId }, select: { id: true, title: true } });
  }

  /** Candidate skills for subject reconcile (§31): skills with eligible evidence ∪ skills with an ACTIVE signal. */
  async reconcileCandidateSkillIds(userId: string, subjectId: string): Promise<string[]> {
    const attempts = await this.prisma.activityAttempt.findMany({
      where: {
        userId,
        status: ActivityAttemptStatus.SUBMITTED,
        isCorrect: { not: null },
        activity: { type: { in: OBJECTIVE_TYPE_LIST }, revision: { lesson: { topic: { module: { level: { track: { subjectId } } } } } } },
      },
      select: { activity: { select: { skills: { select: { skillId: true } }, revision: { select: { lesson: { select: { skills: { select: { skillId: true } } } } } } } } },
    });
    const attributed = new Set<string>();
    for (const a of attempts) {
      const act = a.activity.skills.map((s) => s.skillId);
      for (const sid of act.length ? act : a.activity.revision.lesson.skills.map((s) => s.skillId)) attributed.add(sid);
    }
    // Keep only skills that actually belong to this Subject (subject-scope, §8/59).
    const inSubject = attributed.size
      ? (await this.prisma.skill.findMany({ where: { id: { in: [...attributed] }, subjectId }, select: { id: true } })).map((s) => s.id)
      : [];
    const activeSkills = (
      await this.prisma.learnerSignal.findMany({
        where: { userId, subjectId, type: REPEATED_MISTAKE_SIGNAL_TYPE, status: SignalStatus.ACTIVE, skillId: { not: null } },
        select: { skillId: true },
      })
    ).map((r) => r.skillId as string);
    return [...new Set([...inSubject, ...activeSkills])];
  }

  /** Candidate skills for state-based reconcile (§28): skills in Subject with a state ∪ skills with an ACTIVE
   *  WEAK_SKILL / REVIEW_DUE signal. Deterministic order. */
  async stateSignalCandidateSkillIds(userId: string, subjectId: string, stateTypes: string[]): Promise<string[]> {
    const withState = (
      await this.prisma.learnerSkillState.findMany({ where: { userId, skill: { subjectId } }, select: { skillId: true } })
    ).map((r) => r.skillId);
    const withSignal = (
      await this.prisma.learnerSignal.findMany({
        where: { userId, subjectId, type: { in: stateTypes }, status: SignalStatus.ACTIVE, skillId: { not: null } },
        select: { skillId: true },
      })
    ).map((r) => r.skillId as string);
    return [...new Set([...withState, ...withSignal])].sort();
  }

  /** ACTIVE signals for a subject (read API; deterministic order §33). */
  activeSignalsForSubject(userId: string, subjectId: string) {
    return this.prisma.learnerSignal.findMany({
      where: { userId, subjectId, status: SignalStatus.ACTIVE },
      orderBy: [{ firstDetectedAt: 'desc' }, { skillId: 'asc' }, { id: 'asc' }],
      select: { id: true, type: true, status: true, firstDetectedAt: true, skillId: true, skill: { select: { id: true, name: true } } },
    });
  }

  isUniqueViolation(e: unknown): boolean {
    return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
  }
}
