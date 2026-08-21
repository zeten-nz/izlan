/**
 * Domain error'lar — HTTP-independent (§41). Repository/service bulardan foydalanadi.
 * Nest HTTP exception (UnauthorizedException) faqat keyingi adapter/controller fazasida (1.4C).
 * Result<T,E>/Either/CQRS framework YO'Q (§42) — oddiy typed exception'lar.
 */
export abstract class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

// Phone
export class PhoneInvalidError extends DomainError {}

// OTP
export class OtpChallengeNotFoundError extends DomainError {}
export class OtpExpiredError extends DomainError {}
export class OtpInvalidError extends DomainError {}
export class OtpLockedError extends DomainError {}
export class OtpCooldownError extends DomainError {}
export class OtpRateLimitError extends DomainError {}

// Session / refresh
export class SessionRevokedError extends DomainError {}
export class SessionExpiredError extends DomainError {}
export class RefreshTokenInvalidError extends DomainError {}
export class RefreshReuseDetectedError extends DomainError {}

// Account / user
export class AccountUnavailableError extends DomainError {}
export class DuplicatePhoneError extends DomainError {}

// Access token (JWT)
export class AccessTokenInvalidError extends DomainError {}

// HTTP-layer (CSRF/origin) — controller boundary'da mapping qilinadi
export class CsrfRejectedError extends DomainError {}

// Profile / onboarding
export class ProfileInvalidTimezoneError extends DomainError {}
export class ProfileInvalidDobError extends DomainError {}
export class ProfileIncompleteError extends DomainError {}
export class DobEditNotAllowedError extends DomainError {}
export class ResourceNotFoundError extends DomainError {}

// Learner learning intent (TD-93)
export class LearningSubjectNotAvailableError extends DomainError {}
export class LearningTrackNotAvailableError extends DomainError {}
export class LearningTrackSubjectMismatchError extends DomainError {}

// Placement / diagnostic assessment (Phase 1.5B)
export class OnboardingIncompleteError extends DomainError {}
export class LearningIntentNotFoundError extends DomainError {}
export class AssessmentNotAvailableError extends DomainError {}
export class AssessmentConfigurationInvalidError extends DomainError {}
export class AssessmentAttemptNotFoundError extends DomainError {}
export class AssessmentAlreadyCompletedError extends DomainError {}
export class AssessmentItemNotCurrentError extends DomainError {}
export class AssessmentInvalidResponseError extends DomainError {}
export class AssessmentResponseConflictError extends DomainError {}

// Skill profile derivation (Phase 1.5C)
export class SkillProfileNotDerivedError extends DomainError {}

// Roadmap foundation (Phase 1.6A)
export class RoadmapNotFoundError extends DomainError {}
export class RoadmapAlreadyActiveError extends DomainError {}
export class RoadmapNoEligibleContentError extends DomainError {}
export class RoadmapConfigurationInvalidError extends DomainError {}

// Daily plan foundation (Phase 1.7A)
export class DailyPlanNotFoundError extends DomainError {}
export class DailyPlanNoExecutableContentError extends DomainError {}
export class DailyPlanConfigurationInvalidError extends DomainError {}

// Lesson execution foundation (Phase 1.7B)
export class DailyPlanItemNotFoundError extends DomainError {}
export class LessonNotExecutableError extends DomainError {}
export class LessonAlreadyCompletedError extends DomainError {}
export class LessonProgressNotFoundError extends DomainError {}

// Lesson activity v1 / ActivityAttempt (Phase 1.7B-2)
export class ActivityNotFoundError extends DomainError {}
export class ActivityNotInPinnedRevisionError extends DomainError {}
export class ActivityTypeNotSupportedError extends DomainError {}
export class ActivityPayloadInvalidError extends DomainError {}
export class ActivityInvalidResponseError extends DomainError {}
export class ActivityAttemptRequestConflictError extends DomainError {}

// Lesson completion + mastery (Phase 1.7C)
export class LessonConfigurationInvalidError extends DomainError {}
export class LessonNotReadyForCompletionError extends DomainError {}
export class LessonCompletionUnsupportedActivityError extends DomainError {}

// Learning progress merge (Phase 1.8A)
export class LearningProgressConfigurationInvalidError extends DomainError {}
export class LearningProgressNoEffectiveEvidenceError extends DomainError {}

// Daily missions (Phase 2.0B)
export class DailyMissionConfigurationInvalidError extends DomainError {}

// XP reward (Phase 2.0C-2)
export class XpRewardConfigurationInvalidError extends DomainError {}

// IZL economic reward (Phase 2.1A)
export class RewardConfigurationInvalidError extends DomainError {}

// IZL reservation (Phase 2.1B) — internal primitive; surfaced only if a future endpoint calls it.
export class IzlInsufficientAvailableError extends DomainError {}
export class IzlReservationConflictError extends DomainError {}

// Payment order — subscription purchase intent (Phase 2.1C-PO)
export class PaymentPlanNotAvailableError extends DomainError {}
export class PaymentPlanPriceNotAvailableError extends DomainError {}
export class PaymentOrderRequestConflictError extends DomainError {}
export class PaymentOrderNotFoundError extends DomainError {}

// Payment execution intent (Phase 2.1E)
export class PaymentOrderNotEligibleError extends DomainError {}
export class PaymentAttemptRequestConflictError extends DomainError {}
export class PaymentProviderUnavailableError extends DomainError {}

// Verified payment evidence (Phase 2.1F) — adapter authentication/verification failure (§10). No business writes.
export class PaymentCallbackVerificationError extends DomainError {}

// Verified payment economic finalization (Phase 2.1G)
export class SubscriptionPurchaseActiveConflictError extends DomainError {} // §21 — user already has an ACTIVE subscription; recoverable, no partial effects
export class PaymentFinalizationIntegrityError extends DomainError {} // corrupted / inconsistent finalization state (never silently repaired)

// Subscription discount redemption intent (Phase 2.1C-2)
export class RedemptionOrderNotEligibleError extends DomainError {}
export class RedemptionRateNotAvailableError extends DomainError {}
export class RedemptionCeilingExceededError extends DomainError {}
export class RedemptionRequestConflictError extends DomainError {}
export class RedemptionOpenIntentConflictError extends DomainError {}
export class RedemptionNotFoundError extends DomainError {}

// Subscription discount commit (Phase 2.1D)
export class RedemptionCommitConflictError extends DomainError {}

// Review mastery (Phase 1.9C)
export class ReviewMasteryConfigurationInvalidError extends DomainError {}

// Review session execution (Phase 1.9B-2)
export class ReviewCandidateNotAvailableError extends DomainError {}
export class ReviewSessionNotFoundError extends DomainError {}
export class ReviewSessionNoReviewableActivityError extends DomainError {}
export class ReviewSessionActivityNotAvailableError extends DomainError {}
export class ReviewSessionNotReadyError extends DomainError {}
export class ReviewSessionAlreadyCompletedError extends DomainError {}

// Content authoring (Phase 2.2A-1). Scope failures use the not-found error (IDOR-safe, §17): never reveal
// that a resource exists in another Subject.
export class ContentNotFoundError extends DomainError {}
export class ContentNotDraftError extends DomainError {}
export class ContentEditConflictError extends DomainError {}
export class ContentUniqueConflictError extends DomainError {}
export class ContentAssignmentInvalidError extends DomainError {}

// Content authoring — draft revision + activity authoring (Phase 2.2A-2). Payload validation is enumeration/leak-safe:
// never expose payload/answerKey/parser internals in messages, audit, or logs.
export class ContentActivityPayloadInvalidError extends DomainError {}
export class ContentActivityTypeNotAuthorableError extends DomainError {}
export class ContentReorderInvalidError extends DomainError {}
export class ContentDeleteBlockedError extends DomainError {}

// Content authoring — skill mapping + prerequisite DAG (Phase 2.2A-3). Cross-subject targets use ContentNotFoundError
// (IDOR-safe). Cycle/lifecycle conflicts are enumeration/leak-safe.
export class ContentSkillArchivedError extends DomainError {}
export class ContentPrerequisiteInvalidError extends DomainError {}
export class ContentPrerequisiteCycleError extends DomainError {}
