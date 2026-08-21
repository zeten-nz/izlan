/**
 * Calendar-month arithmetic for subscription billing periods (Phase 2.1G-D, TD-195). Pure + deterministic — no Clock,
 * no Prisma. Adds a whole number of calendar months to a UTC instant with **end-of-month clamping** and preserves the
 * time-of-day. This is the future authority for `SubscriptionCycle.periodEnd = addCalendarMonths(periodStart,
 * planPrice.billingPeriodMonths)` (§4/§36); no cycle is created here.
 *
 *   2026-01-31 +1 → 2026-02-28   ·   2028-01-31 +1 → 2028-02-29 (leap)   ·   2026-03-31 +1 → 2026-04-30
 */
export function addCalendarMonths(start: Date, months: number): Date {
  if (!Number.isInteger(months) || months < 0) throw new RangeError('months must be a non-negative integer');
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth(); // 0-11
  const d = start.getUTCDate();
  const total = m + months;
  const targetYear = y + Math.floor(total / 12);
  const targetMonth = ((total % 12) + 12) % 12;
  const lastDayOfTarget = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate(); // day 0 of next month = last day of target
  const day = Math.min(d, lastDayOfTarget); // clamp (e.g. Jan 31 → Feb 28/29)
  return new Date(Date.UTC(targetYear, targetMonth, day, start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), start.getUTCMilliseconds()));
}
