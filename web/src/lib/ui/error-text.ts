import { ApiError } from '../api/errors';

/** Map a backend error to a concise, user-facing Uzbek message (never leaks payload/internal detail). */
const CODE_TEXT: Record<string, string> = {
  CONTENT_EDIT_CONFLICT: 'Bu ma’lumot boshqa joyda o‘zgartirilgan.',
  CONTENT_NOT_DRAFT: 'Bu holatda tahrirlash mumkin emas (faqat qoralama tahrirlanadi).',
  CONTENT_LIFECYCLE_CONFLICT: 'Amal hozirgi holat bilan mos emas.',
  CONTENT_NOT_FOUND: 'Topilmadi yoki sizga biriktirilmagan.',
  CONTENT_UNIQUE_CONFLICT: 'Bunday qiymat allaqachon mavjud (takroriy).',
  CONTENT_REVIEW_NOT_READY: 'Ko‘rikka yuborishga tayyor emas — bloklovchilarni bartaraf eting.',
  CONTENT_PUBLISH_NOT_READY: 'Nashrga tayyor emas — bloklovchilarni bartaraf eting.',
  CONTENT_PUBLICATION_STATE_INVALID: 'Nashr holati nomuvofiq.',
  CONTENT_ACTIVITY_PAYLOAD_INVALID: 'Faoliyat mazmuni noto‘g‘ri.',
  CONTENT_ACTIVITY_TYPE_NOT_AUTHORABLE: 'Bu faoliyat turini yaratib bo‘lmaydi.',
  CONTENT_REORDER_INVALID: 'Tartib ro‘yxati noto‘g‘ri.',
  CONTENT_SKILL_ARCHIVED: 'Ko‘nikma arxivlangan.',
  CONTENT_PREREQUISITE_INVALID: 'Talab noto‘g‘ri (o‘ziga yoki arxivlangan darsga).',
  CONTENT_PREREQUISITE_CYCLE: 'Bu bog‘lanish tsikl hosil qiladi.',
  CONTENT_ASSIGNMENT_INVALID: 'Bunday foydalanuvchi topilmadi.',
  AUTH_FORBIDDEN: 'Ruxsat yo‘q.',
  AUTH_UNAUTHORIZED: 'Sessiya tugagan. Qayta kiring.',
  AUTH_INVALID_INPUT: 'Kiritilgan ma’lumot noto‘g‘ri.',
  AUTH_OTP_INVALID: 'Kod noto‘g‘ri yoki muddati o‘tgan.',
  AUTH_OTP_LOCKED: 'Juda ko‘p urinish. Birozdan so‘ng qayta urining.',
  AUTH_RATE_LIMITED: 'Juda ko‘p so‘rov. Birozdan so‘ng qayta urining.',
  AUTH_SMS_UNAVAILABLE: 'SMS yuborib bo‘lmadi. Qayta urining.',
};

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return CODE_TEXT[error.code] ?? `Xatolik (${error.code}).`;
  }
  return 'Tarmoq xatosi. Qayta urinib ko‘ring.';
}
