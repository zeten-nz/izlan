import { ApiError, NetworkError, isAbortError } from '../api/errors';
import { defaultT, type TFunc } from '../i18n/i18n-context';

/**
 * Map an error to a concise, localized, user-facing message (never leaks payload/stack/internal detail).
 * Correct taxonomy — only a genuine transport failure is ever presented as "couldn't reach the server":
 *  - AbortError (cancelled/navigated request) → '' (falsy → callers using `{error && …}` render nothing)
 *  - ApiError (HTTP error, incl. UnauthenticatedError) → the localized message for its `code`, else a generic one
 *  - NetworkError (fetch rejected) → the network message
 *  - anything else (programming/unexpected error) → generic message, NOT a false network claim
 * Pass the active `t` for locale-aware text; without it, falls back to the default (Uzbek) translator.
 */
export function describeError(error: unknown, t: TFunc = defaultT): string {
  if (isAbortError(error)) return '';
  if (error instanceof ApiError) {
    const key = `errors.${error.code}`;
    const msg = t(key);
    return msg === key ? t('errors.generic') : msg;
  }
  if (error instanceof NetworkError) return t('errors.network');
  return t('errors.generic');
}
