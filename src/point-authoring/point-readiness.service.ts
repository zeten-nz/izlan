import { Injectable } from '@nestjs/common';
import { BlueprintBindingRole, Prisma, RevisionStatus, SkillContributionRole } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { OBJECTIVE_EVIDENCE_INDEPENDENCE, OBJECTIVE_EVIDENCE_KINDS } from './point-authoring.constants';

export interface PointReadinessItem {
  code: string;
  scope: string;
  targetId?: string;
}
export interface PointReadinessReport {
  pointId: string;
  reviewReady: boolean;
  publishReady: boolean;
  blockers: PointReadinessItem[];
  warnings: PointReadinessItem[];
}

/**
 * V2 point publish-readiness — extends the V1 structural pattern with PEDAGOGICAL / MASTERY-ALIGNMENT hard
 * blockers the V1 lesson checker cannot express (Content Quality §12/§20/§28). Automated validity is necessary,
 * not sufficient: a human ContentReview + the policy gate still apply at publish (§28/§52). Pure read of safe
 * metadata only (never answer keys / payloads). reviewReady = the point body is coherent; publishReady =
 * reviewReady AND no publish blockers.
 */
@Injectable()
export class PointReadinessService {
  constructor(private readonly prisma: PrismaService) {}
  private db(tx?: Prisma.TransactionClient) {
    return tx ?? this.prisma;
  }

  async evaluate(pointId: string, opts: { requireApprovedReview: boolean; requireSourceForPoint: boolean }, tx?: Prisma.TransactionClient): Promise<PointReadinessReport | null> {
    const db = this.db(tx);
    const point = await db.roadmapPoint.findUnique({
      where: { id: pointId },
      select: { id: true, publishedRevisionId: true, level: { select: { status: true, track: { select: { status: true, subject: { select: { status: true } } } } } } },
    });
    if (!point) return null;

    // The editable (DRAFT/REVIEW) revision set is what gets reviewed/published.
    const [pointRev, bpRev, mrRev] = await Promise.all([
      db.roadmapPointRevision.findFirst({ where: { roadmapPointId: pointId, status: { in: [RevisionStatus.DRAFT, RevisionStatus.REVIEW] } }, orderBy: { versionNo: 'desc' }, select: { id: true, title: true, learningOutcome: true } }),
      db.teachingBlueprintRevision.findFirst({ where: { blueprint: { roadmapPointId: pointId }, status: { in: [RevisionStatus.DRAFT, RevisionStatus.REVIEW] } }, orderBy: { versionNo: 'desc' }, select: { id: true } }),
      db.masteryRequirementRevision.findFirst({ where: { requirement: { roadmapPointId: pointId }, status: { in: [RevisionStatus.DRAFT, RevisionStatus.REVIEW] } }, orderBy: { versionNo: 'desc' }, select: { id: true } }),
    ]);
    if (!pointRev || !bpRev || !mrRev) return { pointId, reviewReady: false, publishReady: false, blockers: [{ code: 'NO_EDITABLE_REVISION', scope: 'point' }], warnings: [] };

    const [skills, prereqs, stages, gates] = await Promise.all([
      db.roadmapPointSkillExpectation.findMany({ where: { roadmapPointRevisionId: pointRev.id }, select: { role: true, expectation: { select: { skillId: true } } } }),
      db.roadmapPointPrerequisite.findMany({ where: { roadmapPointRevisionId: pointRev.id }, select: { prerequisitePoint: { select: { id: true, status: true } } } }),
      db.teachingBlueprintStage.findMany({
        where: { blueprintRevisionId: bpRev.id },
        orderBy: { position: 'asc' },
        select: { id: true, stageType: true, bindings: { select: { role: true, activityId: true, activity: { select: { id: true, type: true, revision: { select: { status: true } }, skills: { select: { skillId: true } } } } } } },
      }),
      db.masteryRequirementSkillExpectation.findMany({ where: { requirementRevisionId: mrRev.id }, select: { requiredEvidenceKinds: true, minIndependence: true, expectationRevision: { select: { expectation: { select: { skillId: true } } } } } }),
    ]);

    const reviewBlockers: PointReadinessItem[] = [];
    const publishBlockers: PointReadinessItem[] = [];
    const warnings: PointReadinessItem[] = [];

    // ── REVIEW (body coherence) ──
    if (!pointRev.title || pointRev.title.trim().length === 0) reviewBlockers.push({ code: 'POINT_NO_TITLE', scope: 'point' });
    const canDo = (pointRev.learningOutcome as { canDo?: string[] } | null)?.canDo ?? [];
    if (canDo.length === 0) reviewBlockers.push({ code: 'POINT_NO_OUTCOME', scope: 'point' });
    const requiredSkillIds = skills.filter((s) => s.role === SkillContributionRole.REQUIRED).map((s) => s.expectation.skillId);
    if (requiredSkillIds.length === 0) reviewBlockers.push({ code: 'POINT_NO_REQUIRED_SKILL', scope: 'point' });
    if (stages.length === 0) reviewBlockers.push({ code: 'BLUEPRINT_NO_STAGES', scope: 'blueprint' });

    // EVIDENCE bindings = the mastery-evidence activities. Collect their skills + producible evidence kinds.
    const evidenceActivities = stages.flatMap((st) => st.bindings.filter((b) => b.role === BlueprintBindingRole.EVIDENCE));
    if (evidenceActivities.length === 0) reviewBlockers.push({ code: 'BLUEPRINT_NO_EVIDENCE_STAGE', scope: 'blueprint' });
    // Every bound activity must be a published activity (unpublished/foreign resolves to a missing join → flagged).
    for (const st of stages) {
      for (const b of st.bindings) {
        if (!b.activity || b.activity.revision.status !== RevisionStatus.PUBLISHED) publishBlockers.push({ code: 'BINDING_ACTIVITY_UNPUBLISHED', scope: 'binding', targetId: b.activityId ?? undefined });
      }
    }
    if (gates.length === 0) reviewBlockers.push({ code: 'MASTERY_NO_GATE', scope: 'mastery' });

    // ── PUBLISH (hierarchy + pedagogical alignment) ──
    if (point.level.track.subject.status !== 'PUBLISHED') publishBlockers.push({ code: 'PARENT_NOT_PUBLISHED', scope: 'subject' });
    if (point.level.track.status !== 'PUBLISHED') publishBlockers.push({ code: 'PARENT_NOT_PUBLISHED', scope: 'track' });
    if (point.level.status !== 'PUBLISHED') publishBlockers.push({ code: 'PARENT_NOT_PUBLISHED', scope: 'level' });
    for (const p of prereqs) if (p.prerequisitePoint.status !== 'PUBLISHED') publishBlockers.push({ code: 'PREREQUISITE_NOT_PUBLISHED', scope: 'prerequisite', targetId: p.prerequisitePoint.id });

    // §20 mastery alignment: every mastery-gate skill must have an EVIDENCE activity mapped to it, and that
    // evidence must be able to produce a required evidence kind at the required independence. Recognition-only
    // content cannot satisfy a production requirement (Scenario C) — this is a HARD blocker, not a score.
    const evidenceSkillIds = new Set(evidenceActivities.flatMap((b) => b.activity?.skills.map((s) => s.skillId) ?? []));
    const producibleKinds = new Set<string>(OBJECTIVE_EVIDENCE_KINDS); // pilot: objective activities produce these
    for (const g of gates) {
      const sid = g.expectationRevision.expectation.skillId;
      if (!evidenceSkillIds.has(sid)) {
        publishBlockers.push({ code: 'MASTERY_SKILL_NO_EVIDENCE', scope: 'mastery', targetId: sid });
        continue;
      }
      const required = (g.requiredEvidenceKinds as string[]) ?? [];
      const kindOk = required.length === 0 || required.some((k) => producibleKinds.has(k));
      const independenceOk = OBJECTIVE_EVIDENCE_INDEPENDENCE >= (g.minIndependence ?? 0);
      if (!kindOk || !independenceOk) publishBlockers.push({ code: 'MASTERY_EVIDENCE_KIND_UNSATISFIABLE', scope: 'mastery', targetId: sid });
    }

    // Blocking, unresolved quality issues stop publication (§10/§26).
    const openBlockers = await db.contentQualityIssue.count({ where: { roadmapPointRevisionId: pointRev.id, status: { in: ['OPEN', 'UNDER_REVIEW'] }, severityCode: 'BLOCKER' } });
    if (openBlockers > 0) publishBlockers.push({ code: 'QUALITY_ISSUE_OPEN', scope: 'point' });

    // Policy gates: required human review + required provenance (capability always exists; a point MAY need zero).
    if (opts.requireApprovedReview) {
      const approved = await db.contentReview.count({ where: { roadmapPointRevisionId: pointRev.id, outcome: 'APPROVED' } });
      if (approved === 0) publishBlockers.push({ code: 'REVIEW_REQUIRED', scope: 'point' });
    }
    if (opts.requireSourceForPoint) {
      const sources = await db.contentSourceProvenance.count({ where: { roadmapPointRevisionId: pointRev.id } });
      if (sources === 0) publishBlockers.push({ code: 'PROVENANCE_REQUIRED', scope: 'point' });
    }

    if (prereqs.length === 0) warnings.push({ code: 'NO_PREREQUISITES', scope: 'point' });

    const reviewReady = reviewBlockers.length === 0;
    const publishReady = reviewReady && publishBlockers.length === 0;
    return { pointId, reviewReady, publishReady, blockers: [...reviewBlockers, ...publishBlockers], warnings };
  }
}
