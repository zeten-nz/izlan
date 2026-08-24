import { apiRequest } from './client';
import type { LearnerProfile } from './types';

/** GET /api/profile/me — own profile (never phone/role). */
export function fetchProfile(): Promise<LearnerProfile> {
  return apiRequest<LearnerProfile>('/api/profile/me');
}

export interface ProfileUpdate {
  displayName?: string;
  dateOfBirth?: string; // YYYY-MM-DD
  timezone?: string;
  preferredLanguage?: string; // uz | ru | en
}

/** PATCH /api/profile/me — partial self-edit; returns the updated profile. */
export function updateProfile(patch: ProfileUpdate): Promise<LearnerProfile> {
  return apiRequest<LearnerProfile>('/api/profile/me', { method: 'PATCH', body: patch });
}
