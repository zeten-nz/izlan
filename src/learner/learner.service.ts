import { Injectable } from '@nestjs/common';
import { OnboardingService } from '../onboarding/onboarding.service';
import { LearningIntentRepository } from '../onboarding/learning-intent.repository';
import { PlacementV2Service } from '../placement-v2/placement-v2.service';
import { V2RoadmapService } from '../learning-core/v2-roadmap.service';

export const LEARNER_HOME_POLICY_VERSION = 'learner-home-v1';

/** The server-authoritative first-run stage for the learner app. The frontend routes on this alone. */
export type LearnerStage = 'ONBOARDING' | 'PLACEMENT' | 'TODAY';

export interface LearnerResumeView {
  sessionId: string;
  pointId: string;
  pointTitle: string;
}

export interface LearnerHomeView {
  stage: LearnerStage;
  onboardingCompleted: boolean;
  subject: { id: string; title: string } | null; // the learner's primary subject once one is chosen
  resume: LearnerResumeView | null; // an in-progress teaching session to continue (surfaced on Today)
  policyVersion: string;
}

/**
 * Learner first-run / landing read-model. It ORCHESTRATES existing engine reads to answer one question the
 * frontend used to stitch from 4+ calls: "where should this learner land right now?". It owns no state and
 * duplicates no engine — Onboarding owns completion, Placement owns the decision, Roadmap owns availability and
 * the active-session projection. It only reads and composes:
 *
 *   not onboarded / no usable subject → ONBOARDING
 *   onboarded but no placement decision for the subject → PLACEMENT
 *   placement decided → TODAY (+ a resume action if a teaching session is still open)
 *
 * A fresh-start placement (from-zero) writes a FRESH_START decision, so a learner who deliberately skipped the
 * diagnostic is TODAY — never forced back into a diagnostic.
 */
@Injectable()
export class LearnerHomeService {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly intents: LearningIntentRepository,
    private readonly placement: PlacementV2Service,
    private readonly roadmap: V2RoadmapService,
  ) {}

  async getHome(userId: string): Promise<LearnerHomeView> {
    const status = await this.onboarding.getStatus(userId);
    if (!status.completed) return this.stage('ONBOARDING', status.completed, null, null);

    const primary = await this.primaryIntent(userId);
    if (!primary) return this.stage('ONBOARDING', true, null, null); // completed flag but no usable subject (edge) → choose one

    const subject = { id: primary.subject.id, title: primary.subject.title };
    const decision = await this.placement.getResult(userId, subject.id);
    if (!decision) return this.stage('PLACEMENT', true, subject, null);

    // Placement decided → the learner belongs on Today. Surface a resume action if a session is still open.
    const view = await this.roadmap.getRoadmap(userId, subject.id);
    const active = view.points.find((p) => p.activeSessionId !== null);
    const resume: LearnerResumeView | null = active?.activeSessionId
      ? { sessionId: active.activeSessionId, pointId: active.roadmapPointId, pointTitle: active.title }
      : null;
    return this.stage('TODAY', true, subject, resume);
  }

  /** Primary subject = the earliest complete (track-carrying) intent, else the earliest intent of any kind. */
  private async primaryIntent(userId: string) {
    const list = await this.intents.listByUser(userId);
    return list.find((i) => i.track !== null) ?? list[0] ?? null;
  }

  private stage(stage: LearnerStage, onboardingCompleted: boolean, subject: { id: string; title: string } | null, resume: LearnerResumeView | null): LearnerHomeView {
    return { stage, onboardingCompleted, subject, resume, policyVersion: LEARNER_HOME_POLICY_VERSION };
  }
}
