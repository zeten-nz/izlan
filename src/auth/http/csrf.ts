import { CsrfRejectedError } from '../../common/errors';

/**
 * Web refresh CSRF himoyasi (§31/32/33). Header/origin-based (sinxron CSRF token store MVP'da yo'q).
 * Refresh cookie-authenticated bo'lgani uchun:
 *  1) custom header `X-Izlan-CSRF: 1` (cross-origin oddiy so'rovda yuborib bo'lmaydi — preflight kerak)
 *  2) `Sec-Fetch-Site: cross-site` → rad
 *  3) Origin mavjud bo'lsa — exact allowlist (wildcard/regex YO'Q)
 * Header absent bo'lsa faqat shu sababdan rad etilmaydi (non-browser client, §33).
 */
export function enforceRefreshCsrf(
  headers: Record<string, string | string[] | undefined>,
  allowedOrigins: readonly string[],
): void {
  const csrf = headers['x-izlan-csrf'];
  if (csrf !== '1') throw new CsrfRejectedError('missing or invalid csrf header');

  const secFetchSite = headers['sec-fetch-site'];
  if (secFetchSite === 'cross-site') throw new CsrfRejectedError('cross-site request rejected');

  const origin = headers['origin'];
  if (typeof origin === 'string' && origin.length > 0 && !allowedOrigins.includes(origin)) {
    throw new CsrfRejectedError('origin not allowed');
  }
}
