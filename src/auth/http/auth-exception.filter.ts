import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  AccessTokenInvalidError,
  AccountUnavailableError,
  ActivityAttemptRequestConflictError,
  ActivityInvalidResponseError,
  ActivityNotFoundError,
  ActivityNotInPinnedRevisionError,
  ActivityPayloadInvalidError,
  ActivityTypeNotSupportedError,
  AssessmentAlreadyCompletedError,
  AssessmentAttemptNotFoundError,
  AssessmentConfigurationInvalidError,
  AssessmentInvalidResponseError,
  AssessmentItemNotCurrentError,
  AssessmentNotAvailableError,
  AssessmentResponseConflictError,
  ContentActivityPayloadInvalidError,
  ContentActivityTypeNotAuthorableError,
  ContentAssignmentInvalidError,
  ContentDeleteBlockedError,
  ContentEditConflictError,
  ContentNotDraftError,
  ContentNotFoundError,
  ContentReorderInvalidError,
  ContentUniqueConflictError,
  CsrfRejectedError,
  DailyPlanConfigurationInvalidError,
  DailyPlanItemNotFoundError,
  DailyPlanNoExecutableContentError,
  DailyPlanNotFoundError,
  LearningProgressConfigurationInvalidError,
  LearningProgressNoEffectiveEvidenceError,
  ReviewCandidateNotAvailableError,
  DailyMissionConfigurationInvalidError,
  XpRewardConfigurationInvalidError,
  RewardConfigurationInvalidError,
  IzlInsufficientAvailableError,
  IzlReservationConflictError,
  PaymentPlanNotAvailableError,
  PaymentPlanPriceNotAvailableError,
  PaymentOrderRequestConflictError,
  PaymentOrderNotFoundError,
  PaymentOrderNotEligibleError,
  PaymentAttemptRequestConflictError,
  RedemptionOrderNotEligibleError,
  RedemptionRateNotAvailableError,
  RedemptionCeilingExceededError,
  RedemptionRequestConflictError,
  RedemptionOpenIntentConflictError,
  RedemptionNotFoundError,
  RedemptionCommitConflictError,
  ReviewMasteryConfigurationInvalidError,
  ReviewSessionActivityNotAvailableError,
  ReviewSessionAlreadyCompletedError,
  ReviewSessionNoReviewableActivityError,
  ReviewSessionNotFoundError,
  ReviewSessionNotReadyError,
  LessonAlreadyCompletedError,
  LessonCompletionUnsupportedActivityError,
  LessonConfigurationInvalidError,
  LessonNotExecutableError,
  LessonNotReadyForCompletionError,
  LessonProgressNotFoundError,
  DobEditNotAllowedError,
  DomainError,
  DuplicatePhoneError,
  LearningIntentNotFoundError,
  LearningSubjectNotAvailableError,
  LearningTrackNotAvailableError,
  LearningTrackSubjectMismatchError,
  OnboardingIncompleteError,
  OtpChallengeNotFoundError,
  OtpCooldownError,
  OtpExpiredError,
  OtpInvalidError,
  OtpLockedError,
  OtpRateLimitError,
  PhoneInvalidError,
  ProfileIncompleteError,
  ProfileInvalidDobError,
  ProfileInvalidTimezoneError,
  RefreshReuseDetectedError,
  RefreshTokenInvalidError,
  ResourceNotFoundError,
  RoadmapAlreadyActiveError,
  RoadmapConfigurationInvalidError,
  RoadmapNoEligibleContentError,
  RoadmapNotFoundError,
  SessionExpiredError,
  SessionRevokedError,
  SkillProfileNotDerivedError,
} from '../../common/errors';

interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
}

/**
 * Domain error → HTTP mapping (§40/41/42). Core error'lar HTTP-independent; mapping shu boundary'da.
 * Enumeration-safe & leak-safe: Prisma/JWT/internal detallar, stack, token qiymatlari OSHKOR ETILMAYDI.
 */
@Catch()
export class AuthExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('AuthException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const body = this.map(exception);
    // Token-bearing/auth javoblar cache qilinmasin (§67).
    void reply.header('Cache-Control', 'no-store').status(body.statusCode).send(body);
  }

  private map(e: unknown): ErrorBody {
    // Nest HttpException (ValidationPipe, ForbiddenException, custom throw'lar) — passthrough (leak-safe).
    if (e instanceof HttpException) {
      const status = e.getStatus();
      const resp = e.getResponse();
      // Controller custom shape { statusCode, code, message } bergan bo'lsa — to'g'ridan.
      if (resp && typeof resp === 'object' && 'code' in resp && typeof (resp as { code: unknown }).code === 'string') {
        const r = resp as { code: string; message?: unknown };
        return { statusCode: status, code: r.code, message: String(r.message ?? '') };
      }
      const message = typeof resp === 'string' ? resp : ((resp as { message?: unknown }).message as string) ?? e.message;
      const code =
        status === 403 ? 'AUTH_FORBIDDEN' : status === 400 ? 'AUTH_INVALID_INPUT' : status === 429 ? 'AUTH_RATE_LIMITED' : 'AUTH_ERROR';
      return { statusCode: status, code, message: Array.isArray(message) ? message.join('; ') : String(message) };
    }

    // Domain errors — generic, enumeration/leak-safe.
    if (e instanceof PhoneInvalidError) return { statusCode: 400, code: 'AUTH_INVALID_INPUT', message: 'invalid phone' };
    if (
      e instanceof OtpInvalidError ||
      e instanceof OtpExpiredError ||
      e instanceof OtpChallengeNotFoundError
    ) {
      return { statusCode: 400, code: 'AUTH_OTP_INVALID', message: 'invalid or expired code' };
    }
    if (e instanceof OtpLockedError) return { statusCode: 429, code: 'AUTH_OTP_LOCKED', message: 'too many attempts' };
    if (e instanceof OtpCooldownError || e instanceof OtpRateLimitError) {
      return { statusCode: 429, code: 'AUTH_RATE_LIMITED', message: 'too many requests' };
    }
    if (e instanceof AccountUnavailableError) {
      return { statusCode: 403, code: 'AUTH_ACCOUNT_UNAVAILABLE', message: 'account not available' };
    }
    if (
      e instanceof AccessTokenInvalidError ||
      e instanceof RefreshTokenInvalidError ||
      e instanceof RefreshReuseDetectedError ||
      e instanceof SessionRevokedError ||
      e instanceof SessionExpiredError
    ) {
      return { statusCode: 401, code: 'AUTH_UNAUTHORIZED', message: 'unauthorized' };
    }
    if (e instanceof CsrfRejectedError) return { statusCode: 403, code: 'AUTH_CSRF_REJECTED', message: 'request rejected' };
    if (e instanceof DuplicatePhoneError) return { statusCode: 409, code: 'AUTH_CONFLICT', message: 'conflict' };

    // Profile / onboarding
    if (e instanceof ProfileInvalidTimezoneError) return { statusCode: 400, code: 'PROFILE_INVALID_TIMEZONE', message: 'invalid timezone' };
    if (e instanceof ProfileInvalidDobError) return { statusCode: 400, code: 'PROFILE_INVALID_DOB', message: e.message };
    if (e instanceof DobEditNotAllowedError) return { statusCode: 409, code: 'PROFILE_DOB_LOCKED', message: 'date of birth cannot be changed after onboarding' };
    if (e instanceof ProfileIncompleteError) return { statusCode: 409, code: 'PROFILE_INCOMPLETE', message: e.message };
    if (e instanceof ResourceNotFoundError) return { statusCode: 404, code: 'RESOURCE_NOT_FOUND', message: 'not found' };
    if (e instanceof LearningSubjectNotAvailableError) return { statusCode: 404, code: 'LEARNING_SUBJECT_NOT_AVAILABLE', message: 'subject not available' };
    if (e instanceof LearningTrackNotAvailableError) return { statusCode: 404, code: 'LEARNING_TRACK_NOT_AVAILABLE', message: 'track not available' };
    if (e instanceof LearningTrackSubjectMismatchError) return { statusCode: 400, code: 'LEARNING_TRACK_SUBJECT_MISMATCH', message: 'track does not belong to subject' };

    // Placement / diagnostic assessment (Phase 1.5B)
    if (e instanceof OnboardingIncompleteError) return { statusCode: 409, code: 'ONBOARDING_INCOMPLETE', message: 'onboarding not completed' };
    if (e instanceof LearningIntentNotFoundError) return { statusCode: 404, code: 'LEARNING_INTENT_NOT_FOUND', message: 'not found' };
    if (e instanceof AssessmentNotAvailableError) return { statusCode: 404, code: 'ASSESSMENT_NOT_AVAILABLE', message: 'assessment not available' };
    if (e instanceof AssessmentAttemptNotFoundError) return { statusCode: 404, code: 'ASSESSMENT_ATTEMPT_NOT_FOUND', message: 'not found' };
    if (e instanceof AssessmentAlreadyCompletedError) return { statusCode: 409, code: 'ASSESSMENT_ALREADY_COMPLETED', message: 'attempt already completed' };
    if (e instanceof AssessmentItemNotCurrentError) return { statusCode: 409, code: 'ASSESSMENT_ITEM_NOT_CURRENT', message: 'item is not the current question' };
    if (e instanceof AssessmentResponseConflictError) return { statusCode: 409, code: 'ASSESSMENT_RESPONSE_CONFLICT', message: 'response already recorded with a different answer' };
    if (e instanceof AssessmentInvalidResponseError) return { statusCode: 400, code: 'ASSESSMENT_INVALID_RESPONSE', message: 'invalid response' };
    if (e instanceof AssessmentConfigurationInvalidError) return { statusCode: 409, code: 'ASSESSMENT_CONFIGURATION_INVALID', message: 'assessment temporarily unavailable' };
    if (e instanceof SkillProfileNotDerivedError) return { statusCode: 409, code: 'SKILL_PROFILE_NOT_DERIVED', message: 'skill profile not yet derived' };

    // Roadmap foundation (Phase 1.6A)
    if (e instanceof RoadmapNotFoundError) return { statusCode: 404, code: 'ROADMAP_NOT_FOUND', message: 'not found' };
    if (e instanceof RoadmapAlreadyActiveError) return { statusCode: 409, code: 'ROADMAP_ALREADY_ACTIVE', message: 'an active roadmap already exists for this subject' };
    if (e instanceof RoadmapNoEligibleContentError) return { statusCode: 409, code: 'ROADMAP_NO_ELIGIBLE_CONTENT', message: 'no eligible content for a roadmap' };
    if (e instanceof RoadmapConfigurationInvalidError) return { statusCode: 409, code: 'ROADMAP_CONFIGURATION_INVALID', message: 'roadmap content configuration invalid' };

    // Daily plan foundation (Phase 1.7A)
    if (e instanceof DailyPlanNotFoundError) return { statusCode: 404, code: 'DAILY_PLAN_NOT_FOUND', message: 'no daily plan for today' };
    if (e instanceof DailyPlanNoExecutableContentError) return { statusCode: 409, code: 'DAILY_PLAN_NO_EXECUTABLE_CONTENT', message: 'no executable roadmap content for today' };
    if (e instanceof DailyPlanConfigurationInvalidError) return { statusCode: 409, code: 'DAILY_PLAN_CONFIGURATION_INVALID', message: 'daily plan configuration invalid' };

    // Lesson execution foundation (Phase 1.7B)
    if (e instanceof DailyPlanItemNotFoundError) return { statusCode: 404, code: 'DAILY_PLAN_ITEM_NOT_FOUND', message: 'not found in today\'s plan' };
    if (e instanceof LessonNotExecutableError) return { statusCode: 409, code: 'LESSON_NOT_EXECUTABLE', message: 'lesson is not currently executable' };
    if (e instanceof LessonAlreadyCompletedError) return { statusCode: 409, code: 'LESSON_ALREADY_COMPLETED', message: 'lesson already completed' };
    if (e instanceof LessonProgressNotFoundError) return { statusCode: 404, code: 'LESSON_PROGRESS_NOT_FOUND', message: 'not found' };
    if (e instanceof ActivityNotFoundError) return { statusCode: 404, code: 'ACTIVITY_NOT_FOUND', message: 'not found' };
    if (e instanceof ActivityNotInPinnedRevisionError) return { statusCode: 409, code: 'ACTIVITY_NOT_IN_PINNED_REVISION', message: 'activity is not in the pinned revision' };
    if (e instanceof ActivityTypeNotSupportedError) return { statusCode: 409, code: 'ACTIVITY_TYPE_NOT_SUPPORTED', message: 'activity type not supported' };
    if (e instanceof ActivityPayloadInvalidError) return { statusCode: 409, code: 'ACTIVITY_PAYLOAD_INVALID', message: 'activity temporarily unavailable' };
    if (e instanceof ActivityInvalidResponseError) return { statusCode: 400, code: 'ACTIVITY_INVALID_RESPONSE', message: 'invalid response' };
    if (e instanceof ActivityAttemptRequestConflictError) return { statusCode: 409, code: 'ACTIVITY_ATTEMPT_REQUEST_CONFLICT', message: 'request id already used with a different submission' };
    if (e instanceof LessonConfigurationInvalidError) return { statusCode: 409, code: 'LESSON_CONFIGURATION_INVALID', message: 'lesson content configuration invalid' };
    if (e instanceof LessonNotReadyForCompletionError) return { statusCode: 409, code: 'LESSON_NOT_READY_FOR_COMPLETION', message: 'lesson not ready for completion' };
    if (e instanceof LessonCompletionUnsupportedActivityError) return { statusCode: 409, code: 'LESSON_COMPLETION_UNSUPPORTED_ACTIVITY', message: 'lesson contains an activity not completable yet' };
    if (e instanceof LearningProgressConfigurationInvalidError) return { statusCode: 409, code: 'LEARNING_PROGRESS_CONFIGURATION_INVALID', message: 'learning progress evidence configuration invalid' };
    if (e instanceof LearningProgressNoEffectiveEvidenceError) return { statusCode: 409, code: 'LEARNING_PROGRESS_NO_EFFECTIVE_EVIDENCE', message: 'no effective learning evidence to merge' };
    if (e instanceof ReviewCandidateNotAvailableError) return { statusCode: 409, code: 'REVIEW_CANDIDATE_NOT_AVAILABLE', message: 'lesson is not a current review candidate' };
    if (e instanceof ReviewSessionNotFoundError) return { statusCode: 404, code: 'REVIEW_SESSION_NOT_FOUND', message: 'review session not found' };
    if (e instanceof ReviewSessionNoReviewableActivityError) return { statusCode: 409, code: 'REVIEW_SESSION_NO_REVIEWABLE_ACTIVITY', message: 'no reviewable activity for this skill in the encountered revision' };
    if (e instanceof ReviewSessionActivityNotAvailableError) return { statusCode: 409, code: 'REVIEW_SESSION_ACTIVITY_NOT_AVAILABLE', message: 'activity is not part of this review session' };
    if (e instanceof ReviewSessionNotReadyError) return { statusCode: 409, code: 'REVIEW_SESSION_NOT_READY', message: 'not all selected activities have been attempted' };
    if (e instanceof ReviewSessionAlreadyCompletedError) return { statusCode: 409, code: 'REVIEW_SESSION_ALREADY_COMPLETED', message: 'review session already completed' };
    if (e instanceof ReviewMasteryConfigurationInvalidError) return { statusCode: 409, code: 'REVIEW_MASTERY_CONFIGURATION_INVALID', message: 'review evidence configuration invalid' };
    if (e instanceof DailyMissionConfigurationInvalidError) return { statusCode: 409, code: 'DAILY_MISSION_CONFIGURATION_INVALID', message: 'daily mission configuration invalid' };
    if (e instanceof XpRewardConfigurationInvalidError) return { statusCode: 409, code: 'XP_REWARD_CONFIGURATION_INVALID', message: 'xp reward configuration invalid' };
    if (e instanceof RewardConfigurationInvalidError) return { statusCode: 409, code: 'REWARD_CONFIGURATION_INVALID', message: 'reward configuration invalid' };
    if (e instanceof IzlInsufficientAvailableError) return { statusCode: 409, code: 'IZL_INSUFFICIENT_AVAILABLE', message: 'insufficient available izl' };
    if (e instanceof IzlReservationConflictError) return { statusCode: 409, code: 'IZL_RESERVATION_CONFLICT', message: 'reservation idempotency conflict' };
    if (e instanceof PaymentPlanNotAvailableError) return { statusCode: 404, code: 'PAYMENT_PLAN_NOT_AVAILABLE', message: 'plan not available for purchase' };
    if (e instanceof PaymentPlanPriceNotAvailableError) return { statusCode: 409, code: 'PAYMENT_PLAN_PRICE_NOT_AVAILABLE', message: 'no effective price for this plan' };
    if (e instanceof PaymentOrderRequestConflictError) return { statusCode: 409, code: 'PAYMENT_ORDER_REQUEST_CONFLICT', message: 'client request id already used with a different purchase' };
    if (e instanceof PaymentOrderNotFoundError) return { statusCode: 404, code: 'PAYMENT_ORDER_NOT_FOUND', message: 'payment order not found' };
    if (e instanceof PaymentOrderNotEligibleError) return { statusCode: 409, code: 'PAYMENT_ORDER_NOT_ELIGIBLE', message: 'payment order not eligible for a payment attempt' };
    if (e instanceof PaymentAttemptRequestConflictError) return { statusCode: 409, code: 'PAYMENT_ATTEMPT_REQUEST_CONFLICT', message: 'client request id already used with a different payment attempt' };
    if (e instanceof RedemptionOrderNotEligibleError) return { statusCode: 409, code: 'REDEMPTION_ORDER_NOT_ELIGIBLE', message: 'payment order not eligible for a discount redemption' };
    if (e instanceof RedemptionRateNotAvailableError) return { statusCode: 409, code: 'REDEMPTION_RATE_NOT_AVAILABLE', message: 'no usable izl rate' };
    if (e instanceof RedemptionCeilingExceededError) return { statusCode: 409, code: 'REDEMPTION_CEILING_EXCEEDED', message: 'discount value exceeds the order ceiling' };
    if (e instanceof RedemptionRequestConflictError) return { statusCode: 409, code: 'REDEMPTION_REQUEST_CONFLICT', message: 'client request id already used with a different redemption' };
    if (e instanceof RedemptionOpenIntentConflictError) return { statusCode: 409, code: 'REDEMPTION_OPEN_INTENT_CONFLICT', message: 'an open discount redemption already exists for this order' };
    if (e instanceof RedemptionNotFoundError) return { statusCode: 404, code: 'REDEMPTION_NOT_FOUND', message: 'redemption not found' };
    if (e instanceof RedemptionCommitConflictError) return { statusCode: 409, code: 'REDEMPTION_COMMIT_CONFLICT', message: 'discount commit conflicts with the current order state' };

    // Content authoring (Phase 2.2A-1). Scope failures are surfaced as CONTENT_NOT_FOUND (IDOR-safe, §17).
    if (e instanceof ContentNotFoundError) return { statusCode: 404, code: 'CONTENT_NOT_FOUND', message: 'not found' };
    if (e instanceof ContentNotDraftError) return { statusCode: 409, code: 'CONTENT_NOT_DRAFT', message: 'content is not editable in its current state' };
    if (e instanceof ContentEditConflictError) return { statusCode: 409, code: 'CONTENT_EDIT_CONFLICT', message: 'content was modified by another edit' };
    if (e instanceof ContentUniqueConflictError) return { statusCode: 409, code: 'CONTENT_UNIQUE_CONFLICT', message: 'a conflicting value already exists' };
    if (e instanceof ContentAssignmentInvalidError) return { statusCode: 409, code: 'CONTENT_ASSIGNMENT_INVALID', message: 'invalid subject assignment request' };
    if (e instanceof ContentActivityPayloadInvalidError) return { statusCode: 400, code: 'CONTENT_ACTIVITY_PAYLOAD_INVALID', message: 'activity payload invalid' };
    if (e instanceof ContentActivityTypeNotAuthorableError) return { statusCode: 400, code: 'CONTENT_ACTIVITY_TYPE_NOT_AUTHORABLE', message: 'activity type is not authorable' };
    if (e instanceof ContentReorderInvalidError) return { statusCode: 400, code: 'CONTENT_REORDER_INVALID', message: 'invalid activity order' };
    if (e instanceof ContentDeleteBlockedError) return { statusCode: 409, code: 'CONTENT_DELETE_BLOCKED', message: 'content cannot be deleted in its current state' };

    // Noma'lum (Prisma/internal) — generic 500, DETAIL LEAK YO'Q. Safe kategoriya log qilinadi.
    if (e instanceof DomainError) {
      this.logger.warn(`unmapped domain error: ${e.name}`);
      return { statusCode: 400, code: 'AUTH_ERROR', message: 'request failed' };
    }
    this.logger.error(`internal error: ${e instanceof Error ? e.name : typeof e}`);
    return { statusCode: 500, code: 'INTERNAL', message: 'internal server error' };
  }
}
