import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

/** Explicit-field profile updates (§17) — mass assignment YO'Q. */
export interface ProfileUpdateFields {
  displayName?: string;
  dateOfBirth?: Date;
  timezone?: string;
  preferredLanguage?: string;
}

@Injectable()
export class ProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return tx ?? this.prisma;
  }

  getProfile(userId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).userProfile.findUnique({ where: { userId } });
  }

  updateProfileFields(userId: string, fields: ProfileUpdateFields, tx?: Prisma.TransactionClient) {
    // Har maydon aniq map qilinadi — sensitive maydonlar (status/role/onboardingCompletedAt) o'tmaydi.
    const data: Prisma.UserProfileUpdateInput = {};
    if (fields.displayName !== undefined) data.displayName = fields.displayName;
    if (fields.dateOfBirth !== undefined) data.dateOfBirth = fields.dateOfBirth;
    if (fields.timezone !== undefined) data.timezone = fields.timezone;
    if (fields.preferredLanguage !== undefined) data.preferredLanguage = fields.preferredLanguage;
    return this.db(tx).userProfile.update({ where: { userId }, data });
  }

  /** First-write onboarding completion (§23/41) — faqat hali tugatilmagan bo'lsa. count=1 → biz o'rnatdik. */
  completeOnboardingIfNotDone(userId: string, tx?: Prisma.TransactionClient) {
    return this.db(tx).userProfile.updateMany({
      where: { userId, onboardingCompletedAt: null },
      data: { onboardingCompletedAt: new Date() },
    });
  }
}
