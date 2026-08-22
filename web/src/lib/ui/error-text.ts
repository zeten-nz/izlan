import { ApiError } from '../api/errors';
import { defaultT, type TFunc } from '../i18n/i18n-context';

/**
 * Map a backend error to a concise, localized, user-facing message (never leaks payload/internal detail).
 * Pass the active `t` for locale-aware text; without it, falls back to the default (Uzbek) translator.
 */
export function describeError(error: unknown, t: TFunc = defaultT): string {
  if (error instanceof ApiError) {
    const key = `errors.${error.code}`;
    const msg = t(key);
    return msg === key ? t('errors.generic', { code: error.code }) : msg;
  }
  return t('errors.network');
}
