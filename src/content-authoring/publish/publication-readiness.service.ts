import { Injectable } from '@nestjs/common';
import { ContainerStatus, LessonStatus, MediaModerationStatus, MediaProcessingStatus, Prisma, RevisionStatus, SkillStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { getActivityDefinition } from '../../content/activity/activity-registry';
import { validateActivityPayloadForAuthoring } from '../../content/activity/authoring-payload';

export interface ReadinessItem {
  code: string;
  scope: string;
  targetId?: string;
}
export interface ReadinessReport {
  revisionId: string;
  reviewReady: boolean;
  publishReady: boolean;
  blockers: ReadinessItem[];
  warnings: ReadinessItem[];
}

/**
 * ONE canonical publication-readiness evaluator (Phase 2.2B, §23). Pure read — safe metadata only (never payload /
 * answerKey / markdown / storageKey). Review readiness checks the revision BODY; publish readiness adds hierarchy,
 * prerequisite, skill-archival, media, and current-pointer coherence. Usable inside a transaction (pass `tx`).
 */
@Injectable()
export class PublicationReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return (tx ?? this.prisma) as Prisma.TransactionClient;
  }

  async evaluate(revisionId: string, tx?: Prisma.TransactionClient): Promise<ReadinessReport | null> {
    const rev = await this.db(tx).lessonRevision.findUnique({
      where: { id: revisionId },
      select: {
        id: true,
        lessonId: true,
        lesson: {
          select: {
            id: true, status: true, publishedRevisionId: true,
            skills: { select: { skill: { select: { status: true } } } },
            // prerequisite status AND owning Subject (via its own hierarchy) — the schema does not encode
            // same-subject, so readiness is the final safety gate that must revalidate it (§25/Blocker C).
            prerequisites: {
              select: {
                prerequisiteLesson: {
                  select: {
                    status: true,
                    topic: { select: { module: { select: { level: { select: { track: { select: { subjectId: true } } } } } } } },
                  },
                },
              },
            },
            topic: { select: { status: true, module: { select: { status: true, level: { select: { status: true, track: { select: { status: true, subjectId: true, subject: { select: { status: true } } } } } } } } } },
            publishedRevision: { select: { id: true, status: true, lessonId: true } },
          },
        },
        activities: {
          orderBy: { position: 'asc' },
          select: {
            id: true, type: true, position: true, payload: true, estimatedDurationMin: true,
            skills: { select: { skill: { select: { status: true } } } },
            media: { select: { media: { select: { processingStatus: true, moderationStatus: true, mimeType: true } } } },
          },
        },
      },
    });
    if (!rev) return null;

    const reviewBlockers: ReadinessItem[] = [];
    const publishBlockers: ReadinessItem[] = [];
    const warnings: ReadinessItem[] = [];
    const acts = rev.activities;

    // ── REVIEW body blockers (§24) ──
    if (acts.length === 0) reviewBlockers.push({ code: 'ACTIVITY_NONE', scope: 'revision' });
    const positions = acts.map((a) => a.position).sort((x, y) => x - y);
    if (!positions.every((p, i) => p === i)) reviewBlockers.push({ code: 'ACTIVITY_POSITIONS_INVALID', scope: 'revision' });
    for (const a of acts) {
      const def = getActivityDefinition(a.type);
      if (def.executionKind === 'UNSUPPORTED') { reviewBlockers.push({ code: 'ACTIVITY_TYPE_UNSUPPORTED', scope: 'activity', targetId: a.id }); continue; }
      try {
        validateActivityPayloadForAuthoring(a.type, a.payload); // registry-driven; never leaks payload
      } catch {
        reviewBlockers.push({ code: 'ACTIVITY_PAYLOAD_INVALID', scope: 'activity', targetId: a.id });
      }
      if (a.skills.some((s) => s.skill.status !== SkillStatus.ACTIVE)) reviewBlockers.push({ code: 'ACTIVITY_SKILL_ARCHIVED', scope: 'activity', targetId: a.id });
      // objective activity with no skill mapping → warning (reduces review usefulness; not a data-safety issue)
      if (def.executionKind === 'OBJECTIVE' && a.skills.length === 0) warnings.push({ code: 'OBJECTIVE_NO_SKILL', scope: 'activity', targetId: a.id });
    }

    // ── PUBLISH blockers (§25) ──
    const l = rev.lesson;
    if (l.status === LessonStatus.ARCHIVED) publishBlockers.push({ code: 'LESSON_ARCHIVED', scope: 'lesson', targetId: l.id });
    const hierarchy: Array<[string, ContainerStatus]> = [
      ['subject', l.topic.module.level.track.subject.status],
      ['track', l.topic.module.level.track.status],
      ['level', l.topic.module.level.status],
      ['module', l.topic.module.status],
      ['topic', l.topic.status],
    ];
    for (const [scope, status] of hierarchy) if (status !== ContainerStatus.PUBLISHED) publishBlockers.push({ code: 'PARENT_NOT_PUBLISHED', scope });
    // Prerequisites must be PUBLISHED AND belong to the SAME Subject as this lesson (§25/Blocker C). The DB has no
    // constraint tying a LessonPrerequisite to a same-subject target, so we revalidate here as the final gate. Never
    // expose the foreign Subject/lesson identity — only the safe code + scope are reported.
    const sourceSubjectId = l.topic.module.level.track.subjectId;
    for (const p of l.prerequisites) {
      if (p.prerequisiteLesson.status !== LessonStatus.PUBLISHED) publishBlockers.push({ code: 'PREREQUISITE_NOT_PUBLISHED', scope: 'prerequisite' });
      if (p.prerequisiteLesson.topic.module.level.track.subjectId !== sourceSubjectId) publishBlockers.push({ code: 'PREREQUISITE_SUBJECT_MISMATCH', scope: 'prerequisite' });
    }
    if (l.skills.some((s) => s.skill.status !== SkillStatus.ACTIVE)) publishBlockers.push({ code: 'LESSON_SKILL_ARCHIVED', scope: 'lesson', targetId: l.id });
    if (l.skills.length === 0) warnings.push({ code: 'NO_LESSON_SKILL', scope: 'lesson', targetId: l.id });
    // current-pointer coherence when replacing (§25G/43): existing pointer must reference a PUBLISHED revision of THIS lesson
    if (l.publishedRevisionId !== null) {
      const pr = l.publishedRevision;
      if (!pr || pr.id !== l.publishedRevisionId || pr.status !== RevisionStatus.PUBLISHED || pr.lessonId !== l.id) {
        publishBlockers.push({ code: 'PUBLICATION_POINTER_INVALID', scope: 'lesson', targetId: l.id });
      }
    }
    // media readiness (§27) — IMAGE/AUDIO
    for (const a of acts) {
      if (getActivityDefinition(a.type).payloadContract !== 'LESSON_MEDIA_V1') continue;
      if (a.media.length === 0) { publishBlockers.push({ code: 'MEDIA_MISSING', scope: 'activity', targetId: a.id }); continue; }
      const expectedPrefix = a.type === 'IMAGE' ? 'image/' : 'audio/';
      for (const m of a.media) {
        if (m.media.processingStatus !== MediaProcessingStatus.READY) publishBlockers.push({ code: 'MEDIA_NOT_READY', scope: 'activity', targetId: a.id });
        else if (m.media.moderationStatus === MediaModerationStatus.BLOCKED) publishBlockers.push({ code: 'MEDIA_BLOCKED', scope: 'activity', targetId: a.id });
        else if (!m.media.mimeType.startsWith(expectedPrefix)) publishBlockers.push({ code: 'MEDIA_MIME_MISMATCH', scope: 'activity', targetId: a.id });
        else if (m.media.moderationStatus === MediaModerationStatus.UNREVIEWED) warnings.push({ code: 'MEDIA_UNREVIEWED', scope: 'activity', targetId: a.id });
      }
    }
    // duration cache completeness (§29) — non-blocking
    if (acts.length > 0 && acts.some((a) => a.estimatedDurationMin === null)) warnings.push({ code: 'DURATION_INCOMPLETE', scope: 'revision' });

    const reviewReady = reviewBlockers.length === 0;
    const publishReady = reviewReady && publishBlockers.length === 0;
    return { revisionId: rev.id, reviewReady, publishReady, blockers: [...reviewBlockers, ...publishBlockers], warnings };
  }
}
