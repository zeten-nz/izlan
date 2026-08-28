import type { V2RoadmapPointView } from '../learning-core/v2-roadmap.service';

/**
 * Pure, versioned V2 daily-learning prioritization (daily-learning-v1). No DB / HTTP / clock.
 *
 * The daily action follows the approved priority — IMPORTANT REPAIR > DUE REVIEW > the ONE new learning point >
 * DONE — over the current V2 roadmap projection (attention/availability/acquisition are already derived by the
 * Learning Core; this never re-derives scoring/mastery). The one-new-point-per-day rule is enforced by pinning
 * the day's chosen main point at generation: finishing it does NOT advance to the next curriculum point the same
 * day; repairs/reviews may still surface (they are about established knowledge, not new curriculum).
 */
export const DAILY_LEARNING_POLICY_VERSION = 'daily-learning-v1';
export const DAILY_LEARNING_ENGINE_VERSION = 'daily-learning-v1';

export type DailyActionType = 'LEARN' | 'REPAIR' | 'REVIEW' | 'DONE';

export interface DailyActionResult {
  type: DailyActionType;
  point: { roadmapPointId: string; pointKey: string; title: string } | null;
  skill: { id: string; name: string } | null; // for REVIEW (which skill to review)
  reason: string | null; // AttentionReasonCode for REPAIR/REVIEW, else null
}

/** A point counts as acquired (established) when LEARNED or VALIDATED. */
const isAcquired = (p: V2RoadmapPointView): boolean => p.learned || p.validated;

/** The one NEW-learning point for the day = the earliest available/in-progress not-yet-acquired point (canonical
 *  sort). Snapshotted at generation so finishing early never fans out to the next curriculum point the same day. */
export function selectMainPoint(points: V2RoadmapPointView[]): V2RoadmapPointView | null {
  return points.find((p) => (p.availability === 'AVAILABLE' || p.availability === 'IN_PROGRESS') && !isAcquired(p)) ?? null;
}

/**
 * The single next action from the CURRENT roadmap, constrained to the day's pinned main point for new learning.
 * repair (any acquired point needing repair) > review (any acquired point due) > learn (the pinned main point,
 * only if not yet acquired) > done. New learning is capped to `mainPointId` — never the next curriculum point.
 */
export function deriveTodayAction(points: V2RoadmapPointView[], mainPointId: string | null): DailyActionResult {
  const repair = points.find((p) => isAcquired(p) && p.attention === 'REPAIR_REQUIRED');
  if (repair) return { type: 'REPAIR', point: pointRef(repair), skill: repair.attentionSkill, reason: repair.attentionReason };

  const review = points.find((p) => isAcquired(p) && p.attention === 'REVIEW_DUE');
  if (review) return { type: 'REVIEW', point: pointRef(review), skill: review.attentionSkill, reason: review.attentionReason };

  const main = mainPointId ? points.find((p) => p.roadmapPointId === mainPointId) ?? null : null;
  if (main && !isAcquired(main) && (main.availability === 'AVAILABLE' || main.availability === 'IN_PROGRESS')) {
    return { type: 'LEARN', point: pointRef(main), skill: null, reason: null };
  }
  return { type: 'DONE', point: null, skill: null, reason: null };
}

/** Acquired points that currently need attention (repair/review) — surfaced alongside the main goal. */
export function attentionItems(points: V2RoadmapPointView[]): V2RoadmapPointView[] {
  return points.filter((p) => isAcquired(p) && (p.attention === 'REPAIR_REQUIRED' || p.attention === 'REVIEW_DUE'));
}

function pointRef(p: V2RoadmapPointView) {
  return { roadmapPointId: p.roadmapPointId, pointKey: p.pointKey, title: p.title };
}
