/**
 * Profile-timezone local date (Phase 1.7A §6). "Today" is the calendar date in the learner's IANA
 * timezone — NEVER the server UTC date. Uses Intl (full ICU) — no dependency, no manual offset math.
 */
export function localDateInTimezone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`; // YYYY-MM-DD
}

/** YYYY-MM-DD → a UTC-midnight Date for a Postgres @db.Date column (date-only, no time-shift). */
export function toDateOnly(localDate: string): Date {
  return new Date(`${localDate}T00:00:00.000Z`);
}

/** @db.Date value → YYYY-MM-DD string for responses. */
export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
