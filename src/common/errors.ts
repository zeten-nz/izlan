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

// Password auth (TD-252)
export class PasswordPolicyError extends DomainError {}
export class InvalidCredentialsError extends DomainError {} // generic — unknown phone / no credential / wrong password
export class AuthRateLimitError extends DomainError {}

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

// Assessment authoring (Phase: assessment authoring V1). Staff diagnostic/placement authoring — leak-safe messages
// (never carry answerKey / prompt / config internals). Not-found + out-of-scope reuse ContentNotFoundError (IDOR-safe);
// OCC conflicts reuse ContentEditConflictError — both are canonical across staff authoring.
export class AssessmentEditableVersionExistsError extends DomainError {} // a DRAFT/REVIEW version already exists (§G one editable)
export class AssessmentNotDraftError extends DomainError {} // version/item not editable (owning version not DRAFT)
export class AssessmentNotInReviewError extends DomainError {} // version not in REVIEW (return-draft/publish)
export class AssessmentItemImmutableError extends DomainError {} // item belongs to a REVIEW/PUBLISHED/ARCHIVED version
export class AssessmentNotReadyError extends DomainError {} // readiness gate failed (submit-review/publish)
export class AssessmentInvalidItemError extends DomainError {} // item payload/options/difficulty invalid
export class AssessmentInvalidConfigError extends DomainError {} // placement config invalid
export class AssessmentSkillInvalidError extends DomainError {} // skill not ACTIVE or not in the definition's Subject
export class AssessmentPublicationStateInvalidError extends DomainError {} // incoherent currentVersion pointer at publish

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
export class DailyLearningNotFoundError extends DomainError {} // V2 daily plan not generated for today
export class DailyLearningUnavailableError extends DomainError {} // no subject/roadmap/timezone to plan from

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

// V2 Learning Core (teaching session / mastery / acquisition)
export class RoadmapPointNotFoundError extends DomainError {}
export class RoadmapPointNotTeachableError extends DomainError {}
export class TeachingSessionNotFoundError extends DomainError {}
export class TeachingActivityNotAvailableError extends DomainError {}
export class TeachingSessionNotResumableError extends DomainError {}

// Placement V2 (decision / roadmap generation)
export class PlacementSubjectNotAvailableError extends DomainError {}
export class PlacementAttemptNotFoundError extends DomainError {}
export class PlacementDiagnosticNotReadyError extends DomainError {}

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

// Lesson media (Phase: media foundation). Leak-safe — never carry storageKey / filesystem path in the message.
export class MediaUploadInvalidError extends DomainError {} // no file / malformed multipart
export class MediaTypeNotAllowedError extends DomainError {} // MIME not in the image/audio allowlist (or magic mismatch)
export class MediaTooLargeError extends DomainError {} // over the per-type byte cap
export class MediaStorageUnavailableError extends DomainError {} // no usable storage adapter (e.g. production without one)
export class MediaAssetNotFoundError extends DomainError {}
export class MediaAltTextRequiredError extends DomainError {} // attaching an IMAGE without meaningful alt text (accessibility)

// Content publishing (Phase 2.2B). Readiness/lifecycle/pointer conflicts are leak-safe (never carry payload/answerKey/
// storageKey or a full readiness report in the HTTP message).
export class ContentReviewNotReadyError extends DomainError {}
export class ContentPublishNotReadyError extends DomainError {}
export class ContentLifecycleConflictError extends DomainError {}
export class ContentPublicationStateInvalidError extends DomainError {}

// Phase 2.2D — Topic-scoped bulk content import (TD-253). Carries the specific stable IMPORT_* code + its HTTP status
// so the exception filter maps it generically (no per-code class explosion). Never carries payload / answerKey / body.
export class ContentImportError extends DomainError {
  constructor(
    readonly importCode: string,
    readonly httpStatus: number,
    message = 'import failed',
  ) {
    super(message);
  }
}
