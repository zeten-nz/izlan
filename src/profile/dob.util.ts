import { ProfileInvalidDobError } from '../common/errors';

/**
 * DOB date-only semantikasi (§8/9/40). YYYY-MM-DD → UTC midnight Date (@db.Date).
 * Timezone shift YO'Q: 2007-05-12 doim 2007-05-12. Age SAQLANMAYDI — kerak bo'lsa runtime'da hisoblanadi.
 */
export function parseDobOrThrow(dob: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    throw new ProfileInvalidDobError('dateOfBirth must be YYYY-MM-DD');
  }
  const [y, m, d] = dob.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Kalendar validligi (masalan 2007-02-30 → boshqa oyга o'tib ketadi).
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new ProfileInvalidDobError('invalid calendar date');
  }
  // Kelajakda bo'lmasligi (UTC bugungi kun bilan solishtirish).
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (date.getTime() > todayUtc) {
    throw new ProfileInvalidDobError('dateOfBirth cannot be in the future');
  }
  return date;
}

/** @db.Date Date → YYYY-MM-DD (UTC midnight, shift'siz). */
export function formatDob(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}
