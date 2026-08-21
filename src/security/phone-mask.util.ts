/**
 * Phone masking — faqat log/SecurityEvent taqdimoti xavfsizligi uchun (§59).
 * Canonical DB User.phone to'liq saqlanadi (accepted identity). Bu yagona masking helper.
 * +998901234567 → +99890*****67
 */
export function maskPhone(canonicalPhone: string): string {
  if (canonicalPhone.length < 8) return '***';
  const head = canonicalPhone.slice(0, 6);
  const tail = canonicalPhone.slice(-2);
  return `${head}*****${tail}`;
}
