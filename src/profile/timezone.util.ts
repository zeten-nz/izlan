/**
 * IANA timezone validatsiyasi (§13, TD-91). Node 24 built-in — qo'shimcha dependency yo'q.
 * `Intl.supportedValuesOf('timeZone')` (canonical IANA ro'yxati); fallback DateTimeFormat.
 * GMT+5 kabi non-IANA, bo'sh, noma'lum identifikatorlar rad etiladi.
 */
export function isValidIanaTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0) return false;
  // Canonical IANA ro'yxati; ba'zi valid zonalar (masalan 'UTC') ro'yxatda bo'lmasligi mumkin.
  try {
    const supported = (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
    if (supported.includes(tz)) return true;
  } catch {
    // eski runtime — DateTimeFormat fallback'ga o'tamiz
  }
  // Runtime validatsiya (reliable): noto'g'ri tz throw qiladi ('GMT+5', bo'sh, noma'lum).
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
