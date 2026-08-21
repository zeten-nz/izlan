/**
 * User-facing (Uzbek) labels for readiness blocker/warning codes. Unknown/future codes fall back to a safe generic
 * label plus the raw code string (never the raw payload). Keep in sync with the backend readiness codes.
 */
const READINESS_LABELS: Record<string, string> = {
  // blockers
  ACTIVITY_NONE: 'Faoliyatlar yo‘q — kamida bitta faoliyat qo‘shing.',
  ACTIVITY_POSITIONS_INVALID: 'Faoliyatlar tartibi noto‘g‘ri.',
  ACTIVITY_TYPE_UNSUPPORTED: 'Qo‘llab-quvvatlanmaydigan faoliyat turi mavjud.',
  ACTIVITY_PAYLOAD_INVALID: 'Faoliyat mazmuni noto‘g‘ri.',
  ACTIVITY_SKILL_ARCHIVED: 'Faoliyatga arxivlangan ko‘nikma biriktirilgan.',
  PARENT_NOT_PUBLISHED: 'Yuqori bosqich (Subject/Track/Level/Module/Topic) hali nashr etilmagan.',
  LESSON_ARCHIVED: 'Dars arxivlangan.',
  PREREQUISITE_NOT_PUBLISHED: 'Talab qilingan dars hali nashr etilmagan.',
  PREREQUISITE_SUBJECT_MISMATCH: 'Talab qilingan dars boshqa fanga tegishli.',
  LESSON_SKILL_ARCHIVED: 'Darsga arxivlangan ko‘nikma biriktirilgan.',
  PUBLICATION_POINTER_INVALID: 'Nashr ko‘rsatkichi nomuvofiq.',
  MEDIA_MISSING: 'Media fayl biriktirilmagan.',
  MEDIA_NOT_READY: 'Media hali tayyor emas.',
  MEDIA_BLOCKED: 'Media bloklangan.',
  MEDIA_MIME_MISMATCH: 'Media turi mos kelmaydi.',
  // warnings
  OBJECTIVE_NO_SKILL: 'Savolga ko‘nikma biriktirilmagan (tavsiya).',
  NO_LESSON_SKILL: 'Darsga ko‘nikma biriktirilmagan (tavsiya).',
  MEDIA_UNREVIEWED: 'Media hali ko‘rib chiqilmagan (tavsiya).',
  DURATION_INCOMPLETE: 'Ba’zi faoliyatlarda davomiylik ko‘rsatilmagan (tavsiya).',
};

export function readinessLabel(code: string): string {
  return READINESS_LABELS[code] ?? `Nomaʼlum holat (${code})`;
}
