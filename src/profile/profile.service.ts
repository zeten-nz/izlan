import { Injectable } from '@nestjs/common';
import { DobEditNotAllowedError, ProfileInvalidTimezoneError, ResourceNotFoundError } from '../common/errors';
import { ProfileRepository, ProfileUpdateFields } from './profile.repository';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { isValidIanaTimezone } from './timezone.util';
import { parseDobOrThrow, formatDob } from './dob.util';

export interface ProfileView {
  id: string;
  displayName: string | null;
  dateOfBirth: string | null; // YYYY-MM-DD
  timezone: string | null;
  preferredLanguage: string | null;
  onboarding: { completed: boolean; completedAt: string | null };
}

@Injectable()
export class ProfileService {
  constructor(private readonly repo: ProfileRepository) {}

  async getMyProfile(userId: string): Promise<ProfileView> {
    const p = await this.repo.getProfile(userId);
    if (!p) throw new ResourceNotFoundError('profile not found');
    return this.toView(p);
  }

  async updateMyProfile(userId: string, dto: UpdateProfileDto): Promise<ProfileView> {
    const p = await this.repo.getProfile(userId);
    if (!p) throw new ResourceNotFoundError('profile not found');
    const onboarded = p.onboardingCompletedAt != null;

    const fields: ProfileUpdateFields = {};
    if (dto.displayName !== undefined) fields.displayName = dto.displayName;
    if (dto.preferredLanguage !== undefined) fields.preferredLanguage = dto.preferredLanguage;
    if (dto.timezone !== undefined) {
      if (!isValidIanaTimezone(dto.timezone)) throw new ProfileInvalidTimezoneError('invalid IANA timezone');
      fields.timezone = dto.timezone;
    }
    if (dto.dateOfBirth !== undefined) {
      // §25 xavfsizlik cheklovi: onboarding'dan keyin DOB oddiy PATCH orqali o'zgartirilmaydi (policy OPEN).
      if (onboarded) throw new DobEditNotAllowedError('date of birth cannot be changed after onboarding');
      fields.dateOfBirth = parseDobOrThrow(dto.dateOfBirth); // ProfileInvalidDobError throw qilishi mumkin
    }

    await this.repo.updateProfileFields(userId, fields);
    return this.getMyProfile(userId);
  }

  private toView(p: {
    userId: string;
    displayName: string | null;
    dateOfBirth: Date | null;
    timezone: string | null;
    preferredLanguage: string | null;
    onboardingCompletedAt: Date | null;
  }): ProfileView {
    return {
      id: p.userId,
      displayName: p.displayName,
      dateOfBirth: formatDob(p.dateOfBirth),
      timezone: p.timezone,
      preferredLanguage: p.preferredLanguage,
      onboarding: {
        completed: p.onboardingCompletedAt != null,
        completedAt: p.onboardingCompletedAt?.toISOString() ?? null,
      },
    };
    // Phone/role/permission/SecurityEvent/token — HECH QACHON qaytarilmaydi (§7).
  }
}
