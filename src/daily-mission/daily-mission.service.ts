import { Injectable, Logger } from '@nestjs/common';
import { Clock } from '../common/clock';
import { DailyMissionConfigurationInvalidError } from '../common/errors';
import { localDateInTimezone, toDateOnly } from '../daily-plan/local-date.util';
import { XpService } from '../xp/xp.service';
import { DailyMissionIzlService } from '../finance/reward/daily-mission-izl.service';
import { DailyMissionRepository } from './daily-mission.repository';
import { MISSION_CATALOG, MissionEvidence } from './mission/daily-mission.policy';

const RECONCILE_WINDOW_MS = 48 * 60 * 60 * 1000; // generous UTC bound; exact learner-local day filtered in-memory (DST-safe, §40)

export interface MissionView {
  code: string;
  completed: boolean;
  completedAt: string | null;
  policyVersion: string;
}
export interface DailyMissionsView {
  localDate: string;
  timezone: string;
  missions: MissionView[];
}

/**
 * Daily Mission Foundation (Phase 2.0B, daily-missions-v1). Materializes append-only mission completions from
 * append-only objective ActivityAttempt evidence at the learner-local day. NO reward/XP/IZL, NO skill state,
 * NO signal, NO DailyPlan/Roadmap/ReviewSession writes (TD-136/139). Mission completion ≠ reward.
 */
@Injectable()
export class DailyMissionService {
  private readonly logger = new Logger('DailyMission');

  constructor(
    private readonly repo: DailyMissionRepository,
    private readonly clock: Clock,
    private readonly xp: XpService,
    private readonly izl: DailyMissionIzlService,
  ) {}

  /** Downstream advisory hook after a persisted objective ActivityAttempt (§23). Failure never rolls back the
   *  attempt (§22); timezone missing → defer safely (§21). Idempotent (unique per user+mission+localDate). */
  async evaluateActivityAttempt(userId: string, attemptId: string): Promise<void> {
    const evidence = await this.repo.attemptEvidence(userId, attemptId);
    if (!evidence) return; // not own / not found / not objective
    const tz = await this.repo.profileTimezone(userId);
    if (!tz) {
      this.logger.warn(`mission evaluation deferred (no timezone) for attempt ${attemptId}`); // §21 defer
      return;
    }
    const localDate = toDateOnly(localDateInTimezone(evidence.submittedAt, tz)); // learner-local mission day (§19)
    for (const m of MISSION_CATALOG) {
      if (m.qualifies(evidence)) {
        await this.repo.createCompletion({ userId, missionCode: m.code, policyVersion: m.version, localDate, timezoneSnapshot: tz, completedAt: evidence.submittedAt, activityAttemptId: evidence.attemptId });
      }
    }
    await this.bridgeMissionRewards(userId, localDate); // Phase 2.0C-2 XP + 2.1A IZL bridges (§25); failure never rolls back the completion
  }

  /** Downstream reward bridges for the day's completions (idempotent; never throw — mission completion must not
   *  roll back on reward failure). XP (2.0C-2/2.0D) and IZL (2.1A) are INDEPENDENT branches — neither gates the
   *  other (§37/§38). */
  private async bridgeMissionRewards(userId: string, localDate: Date): Promise<void> {
    const completions = await this.repo.completionsForDay(userId, localDate);
    for (const c of completions) {
      await this.xp.tryEnsureMissionXpGranted(userId, c.id); // XP branch
      await this.izl.tryEnsureMissionReward(userId, c.id); // IZL branch (independent)
    }
    await this.xp.tryRecomputeProjection(userId); // rebuild XpBalance projection (§20)
  }

  /** Read today's mission catalog + persisted completion state (READ-ONLY, §38). */
  async getToday(userId: string): Promise<DailyMissionsView> {
    const tz = await this.requireTimezone(userId);
    const localDateStr = localDateInTimezone(this.clock.now(), tz);
    const completions = await this.repo.completionsForDay(userId, toDateOnly(localDateStr));
    const byCode = new Map(completions.map((c) => [c.missionCode, c]));
    return {
      localDate: localDateStr,
      timezone: tz,
      missions: MISSION_CATALOG.map((m) => {
        const c = byCode.get(m.code);
        return { code: m.code, completed: !!c, completedAt: c ? c.completedAt.toISOString() : null, policyVersion: c ? c.policyVersion : m.version };
      }),
    };
  }

  /** Repair missing current-day completions from existing evidence; earliest qualifying attempt wins (§39/41). */
  async reconcileToday(userId: string): Promise<DailyMissionsView> {
    const tz = await this.requireTimezone(userId);
    const now = this.clock.now();
    const localDateStr = localDateInTimezone(now, tz);
    const localDate = toDateOnly(localDateStr);
    const window = await this.repo.eligibleAttempts(userId, new Date(now.getTime() - RECONCILE_WINDOW_MS));
    const todays = window.filter((a: MissionEvidence) => localDateInTimezone(a.submittedAt, tz) === localDateStr); // exact local-day (already submittedAt ASC, id ASC)
    for (const m of MISSION_CATALOG) {
      const earliest = todays.find((a) => m.qualifies(a)); // earliest qualifying evidence (§41)
      if (earliest) await this.repo.createCompletion({ userId, missionCode: m.code, policyVersion: m.version, localDate, timezoneSnapshot: tz, completedAt: earliest.submittedAt, activityAttemptId: earliest.attemptId });
    }
    await this.bridgeMissionRewards(userId, localDate); // Phase 2.0C-2 XP + 2.1A IZL bridges for repaired completions (§25)
    return this.getToday(userId);
  }

  private async requireTimezone(userId: string): Promise<string> {
    const tz = await this.repo.profileTimezone(userId);
    if (!tz) throw new DailyMissionConfigurationInvalidError('no profile timezone'); // §21 (GET/reconcile)
    return tz;
  }
}
