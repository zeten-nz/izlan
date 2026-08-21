import { Injectable } from '@nestjs/common';
import {
  LearningSubjectNotAvailableError,
  LearningTrackNotAvailableError,
  LearningTrackSubjectMismatchError,
  ProfileIncompleteError,
  ResourceNotFoundError,
} from '../common/errors';
import { ProfileRepository } from '../profile/profile.repository';
import { OnboardingContentRepository } from './onboarding-content.repository';
import { LearningIntentRepository } from './learning-intent.repository';

export interface OnboardingStatus {
  completed: boolean;
  canComplete: boolean;
  missing: string[]; // machine-readable field kodlar
}

/**
 * Onboarding readiness/completion (§19–24). Authority = UserProfile.onboardingCompletedAt (qo'shimcha boolean yo'q).
 * Profile-level required: displayName, dateOfBirth, timezone. Resumable (holat DB'dan derived).
 *
 * ⚠️ Subject/Track SELECTION persistence modeli schema'da YO'Q (§30/31) → onboarding "completion"
 * hozircha faqat profile-level. Subject tanlash discovery bilan mavjud, lekin saqlanmaydi
 * (assessment kirish nuqtasida keladi). Bu ARCHITECTURE GAP — owner review.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly profileRepo: ProfileRepository,
    private readonly contentRepo: OnboardingContentRepository,
    private readonly intentRepo: LearningIntentRepository,
  ) {}

  private profileMissing(p: { displayName: string | null; dateOfBirth: Date | null; timezone: string | null } | null): string[] {
    const missing: string[] = [];
    if (!p?.displayName) missing.push('displayName');
    if (!p?.dateOfBirth) missing.push('dateOfBirth');
    if (!p?.timezone) missing.push('timezone');
    return missing;
  }

  private async computeMissing(userId: string): Promise<{ missing: string[]; completedAt: Date | null }> {
    const p = await this.profileRepo.getProfile(userId);
    const missing = this.profileMissing(p);
    // §23: kamida bitta COMPLETE (track to'ldirilgan) va hozir learner-visible intent.
    const completeIntents = await this.intentRepo.countCompleteVisible(userId);
    if (completeIntents === 0) missing.push('learningIntent');
    return { missing, completedAt: p?.onboardingCompletedAt ?? null };
  }

  async getStatus(userId: string): Promise<OnboardingStatus> {
    const { missing, completedAt } = await this.computeMissing(userId);
    return { completed: completedAt != null, canComplete: missing.length === 0, missing };
  }

  async complete(userId: string): Promise<{ completed: boolean; completedAt: string }> {
    const { missing, completedAt } = await this.computeMissing(userId);
    if (completedAt) {
      // §25: allaqachon tugatilgan — first-write timestamp saqlanadi, yangi readiness qoidalari qayta qo'llanmaydi.
      return { completed: true, completedAt: completedAt.toISOString() };
    }
    if (missing.length > 0) throw new ProfileIncompleteError(`missing: ${missing.join(',')}`);

    await this.profileRepo.completeOnboardingIfNotDone(userId); // conditional first-write
    const updated = await this.profileRepo.getProfile(userId);
    return { completed: true, completedAt: updated!.onboardingCompletedAt!.toISOString() };
    // `next` field YO'Q (§24) — assessment entry route hali aniqlanmagan.
  }

  // ── Learning intent (TD-93) ──
  listIntents(userId: string) {
    return this.intentRepo.listByUser(userId); // faqat own (§29)
  }

  async saveIntent(userId: string, subjectId: string, trackId: string | undefined) {
    const subject = await this.contentRepo.findPublishedSubject(subjectId);
    if (!subject) throw new LearningSubjectNotAvailableError('subject not available'); // DRAFT/ARCHIVED/unknown yashirin

    let trackData: { trackId: string | null } | undefined;
    if (trackId !== undefined) {
      const track = await this.contentRepo.findPublishedTrack(trackId);
      if (!track) throw new LearningTrackNotAvailableError('track not available');
      if (track.subjectId !== subjectId) throw new LearningTrackSubjectMismatchError('track does not belong to subject');
      trackData = { trackId };
    }
    // trackData undefined (subject-only) → mavjud track o'zgarmaydi; yangi → track null (resumable §5/21).
    await this.intentRepo.upsert(userId, subjectId, trackData);
    return this.listIntents(userId);
  }

  listSubjects() {
    return this.contentRepo.listPublishedSubjects();
  }

  async listTracks(subjectId: string) {
    // Draft/archived/mavjud bo'lmagan subject → learner uchun 404 (yashirin content oshkor etilmaydi, §38).
    const subject = await this.contentRepo.findPublishedSubject(subjectId);
    if (!subject) throw new ResourceNotFoundError('subject not found');
    return this.contentRepo.listPublishedTracks(subjectId);
  }
}
