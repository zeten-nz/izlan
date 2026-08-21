import { Injectable } from '@nestjs/common';
import { ContainerStatus, LessonStatus, SignalStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { parseTriggerActivityIds, REPEATED_MISTAKE_SIGNAL_TYPE } from '../learner-signals/repeated-mistake.detector';
import {
  CandidateFacts,
  EncounteredVisibleLesson,
  REVIEW_SUPPORTED_SIGNAL_TYPES,
  SkillMeta,
  SkillSignals,
} from './candidate/review-candidate.types';

const EMPTY: CandidateFacts = { skills: [], signalsBySkill: new Map(), visibleLessons: new Map(), lessonSkill: new Set(), activitySkillCurrent: new Set() };
const mapKey = (skillId: string, lessonId: string) => `${skillId}::${lessonId}`;

/** Review-candidate read model. READ-ONLY: reads ACTIVE signals + curriculum/exposure via O(few) batched
 *  queries. Writes NOTHING (no signals, skill state, roadmap, plan, progress, attempts). */
@Injectable()
export class ReviewRepository {
  constructor(private readonly prisma: PrismaService) {}

  getSubject(subjectId: string) {
    return this.prisma.subject.findUnique({ where: { id: subjectId }, select: { id: true, title: true } });
  }

  /** Assemble all candidate facts for one (user, subject) — batched, deterministic, no writes. */
  async loadFacts(userId: string, subjectId: string): Promise<CandidateFacts> {
    // 1. ACTIVE supported signals with a non-null skill (§4/5).
    const signals = await this.prisma.learnerSignal.findMany({
      where: { userId, subjectId, status: SignalStatus.ACTIVE, type: { in: [...REVIEW_SUPPORTED_SIGNAL_TYPES] }, skillId: { not: null } },
      select: { type: true, skillId: true, evidenceRefs: true },
    });
    if (signals.length === 0) return EMPTY;

    // Group signal types + collect repeated-mistake trigger activity ids per skill.
    const signalsBySkill = new Map<string, SkillSignals>();
    const triggerActivityIdsBySkill = new Map<string, string[]>();
    for (const s of signals) {
      const skillId = s.skillId as string;
      const entry = signalsBySkill.get(skillId) ?? { skillId, signalTypes: [], directTriggerLessonIds: [] };
      if (!entry.signalTypes.includes(s.type)) entry.signalTypes.push(s.type);
      signalsBySkill.set(skillId, entry);
      if (s.type === REPEATED_MISTAKE_SIGNAL_TYPE) {
        const ids = parseTriggerActivityIds(s.evidenceRefs); // strict; malformed → [] (§16/46)
        if (ids.length) triggerActivityIdsBySkill.set(skillId, [...(triggerActivityIdsBySkill.get(skillId) ?? []), ...ids]);
      }
    }

    // 2. Skills that actually belong to this Subject (subject scope, §30).
    const skillIds = [...signalsBySkill.keys()];
    const skills: SkillMeta[] = await this.prisma.skill.findMany({ where: { id: { in: skillIds }, subjectId }, select: { id: true, name: true, sortOrder: true } });
    const inSubjectSkillIds = new Set(skills.map((s) => s.id));

    // 3. Encountered logical Lessons = has progress OR completion (§6). COMPLETED wins (§8/52).
    const [progress, completions] = await Promise.all([
      this.prisma.learnerLessonProgress.findMany({ where: { userId }, select: { lessonId: true } }),
      this.prisma.learnerLessonCompletion.findMany({ where: { userId }, select: { lessonId: true } }),
    ]);
    const completedSet = new Set(completions.map((c) => c.lessonId));
    const encounteredIds = [...new Set([...progress.map((p) => p.lessonId), ...completedSet])];
    if (encounteredIds.length === 0) return { skills, signalsBySkill, visibleLessons: new Map(), lessonSkill: new Set(), activitySkillCurrent: new Set() };

    // 4. Currently learner-visible encountered Lessons in this Subject (§9/30). Title = current published revision.
    const lessons = await this.prisma.lesson.findMany({
      where: {
        id: { in: encounteredIds },
        status: LessonStatus.PUBLISHED,
        publishedRevisionId: { not: null },
        topic: { status: ContainerStatus.PUBLISHED, module: { status: ContainerStatus.PUBLISHED, level: { status: ContainerStatus.PUBLISHED, track: { status: ContainerStatus.PUBLISHED, subjectId } } } },
      },
      select: {
        id: true,
        topicId: true,
        sortOrder: true,
        publishedRevisionId: true,
        publishedRevision: { select: { title: true } },
        topic: { select: { sortOrder: true, module: { select: { sortOrder: true, level: { select: { sortOrder: true } } } } } },
      },
    });
    const visibleLessons = new Map<string, EncounteredVisibleLesson>();
    const revisionToLesson = new Map<string, string>();
    for (const l of lessons) {
      visibleLessons.set(l.id, {
        lessonId: l.id,
        title: l.publishedRevision?.title ?? '',
        topicId: l.topicId,
        exposure: completedSet.has(l.id) ? 'COMPLETED' : 'IN_PROGRESS',
        levelSort: l.topic.module.level.sortOrder,
        moduleSort: l.topic.module.sortOrder,
        topicSort: l.topic.sortOrder,
        lessonSort: l.sortOrder,
      });
      if (l.publishedRevisionId) revisionToLesson.set(l.publishedRevisionId, l.id);
    }
    const visibleLessonIds = [...visibleLessons.keys()];
    if (visibleLessonIds.length === 0) return { skills, signalsBySkill, visibleLessons, lessonSkill: new Set(), activitySkillCurrent: new Set() };

    // 5. Explicit LessonSkill mappings (§11).
    const lessonSkillRows = await this.prisma.lessonSkill.findMany({ where: { lessonId: { in: visibleLessonIds }, skillId: { in: skillIds } }, select: { lessonId: true, skillId: true } });
    const lessonSkill = new Set(lessonSkillRows.map((r) => mapKey(r.skillId, r.lessonId)));

    // 6. Current published revision ActivitySkill mappings (§11/13).
    const activitySkillRows = await this.prisma.activitySkill.findMany({
      where: { skillId: { in: skillIds }, activity: { lessonRevisionId: { in: [...revisionToLesson.keys()] } } },
      select: { skillId: true, activity: { select: { lessonRevisionId: true } } },
    });
    const activitySkillCurrent = new Set<string>();
    for (const r of activitySkillRows) {
      const lessonId = revisionToLesson.get(r.activity.lessonRevisionId);
      if (lessonId) activitySkillCurrent.add(mapKey(r.skillId, lessonId));
    }

    // 7. REPEATED_MISTAKE direct-trigger provenance: trigger Activity (any historical revision) → logical Lesson (§14).
    const allTriggerActivityIds = [...new Set([...triggerActivityIdsBySkill.values()].flat())];
    if (allTriggerActivityIds.length) {
      const triggerActivities = await this.prisma.activity.findMany({ where: { id: { in: allTriggerActivityIds } }, select: { id: true, revision: { select: { lessonId: true } } } });
      const activityToLesson = new Map(triggerActivities.map((a) => [a.id, a.revision.lessonId]));
      for (const [skillId, activityIds] of triggerActivityIdsBySkill) {
        if (!inSubjectSkillIds.has(skillId)) continue;
        const lessonIds = [...new Set(activityIds.map((aid) => activityToLesson.get(aid)).filter((lid): lid is string => !!lid && visibleLessons.has(lid)))]; // encountered+visible+subject (§14/16/58)
        const entry = signalsBySkill.get(skillId)!;
        entry.directTriggerLessonIds = lessonIds;
      }
    }

    return { skills, signalsBySkill, visibleLessons, lessonSkill, activitySkillCurrent };
  }
}
