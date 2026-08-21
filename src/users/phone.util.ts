import { PhoneInvalidError } from '../common/errors';

/**
 * Phone normalization — bitta backend authority (TD-16, AUTH §14).
 * Canonical: +998XXXXXXXXX (E.164). Frontend normalizatsiyasiga tayanilmaydi.
 * MVP strukturaviy validatsiya: +998 + roppa-rosa 9 raqam.
 * O'zgaruvchi mobil-operator prefiks ro'yxati hard-code qilinmaydi.
 */
export function normalizeUzPhone(input: string | null | undefined): string {
  if (input == null) throw new PhoneInvalidError('phone is required');

  const trimmed = String(input).trim();
  if (trimmed.length === 0) throw new PhoneInvalidError('phone is empty');

  // Faqat raqam va boshidagi '+' saqlanadi; separatorlar (bo'shliq, -, (, )) olib tashlanadi.
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^\d]/g, '');

  if (digits.length === 0) throw new PhoneInvalidError('phone has no digits');
  // Harf yoki noto'g'ri joyda '+' — raqamlardan tashqari belgilar bo'lsa rad etiladi (garbage himoyasi).
  const allowed = /^\+?[\d\s()\-]+$/.test(trimmed);
  if (!allowed) throw new PhoneInvalidError('phone contains invalid characters');

  let national: string;
  if (hasPlus) {
    // +998......... → 998 + 9
    if (!digits.startsWith('998')) throw new PhoneInvalidError('only +998 (Uzbekistan) is supported');
    national = digits.slice(3);
  } else if (digits.startsWith('998')) {
    national = digits.slice(3);
  } else {
    // Mahalliy: 9 raqam (masalan 901234567)
    national = digits;
  }

  if (!/^\d{9}$/.test(national)) {
    throw new PhoneInvalidError('phone must be +998 followed by exactly 9 digits');
  }

  return `+998${national}`;
}
