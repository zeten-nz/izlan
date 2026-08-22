import type { ActivityType } from '../api/types';

export type ActivityCategory = 'markdown' | 'objective' | 'media' | 'unsupported';

/**
 * Frontend classification of ActivityType (mirrors the backend Activity registry). Drives which builder UI is shown
 * and which types are creatable. MEDIA (IMAGE/AUDIO) is display-only in 2.2C (authoring deferred); UNSUPPORTED types
 * (SPEAKING/WRITING/LISTENING/AI_INTERACTION/VIDEO) can never be created.
 */
export const MARKDOWN_TYPES: readonly ActivityType[] = ['TEXT', 'EXPLANATION', 'EXAMPLE'];
export const OBJECTIVE_TYPES: readonly ActivityType[] = ['MINI_QUESTION', 'PRACTICE', 'MASTERY_TEST'];
export const MEDIA_TYPES: readonly ActivityType[] = ['IMAGE', 'AUDIO'];

export function activityCategory(type: ActivityType): ActivityCategory {
  if (MARKDOWN_TYPES.includes(type)) return 'markdown';
  if (OBJECTIVE_TYPES.includes(type)) return 'objective';
  if (MEDIA_TYPES.includes(type)) return 'media';
  return 'unsupported';
}

/** Only markdown + objective types may be authored/created in this phase. */
export const CREATABLE_TYPES: readonly ActivityType[] = [...MARKDOWN_TYPES, ...OBJECTIVE_TYPES];

export function isCreatableType(type: ActivityType): boolean {
  return CREATABLE_TYPES.includes(type);
}

/** i18n key for an ActivityType display label (see `activity.typeLabels.*`). */
export function activityTypeLabelKey(type: ActivityType): string {
  return `activity.typeLabels.${type}`;
}
