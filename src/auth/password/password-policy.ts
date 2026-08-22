import { PasswordPolicyError } from '../../common/errors';

/**
 * MVP password contract (TD-252 §4): 8..128 characters. No composition rules (no forced upper/symbol/number).
 * Passwords are NEVER trimmed — " password " differs from "password". Frontend mirrors the same bounds.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Enforce the length policy (no trimming). Throws PasswordPolicyError (→ 400 AUTH_PASSWORD_POLICY) on violation. */
export function assertPasswordPolicy(password: string): string {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new PasswordPolicyError(`password must be ${PASSWORD_MIN_LENGTH}..${PASSWORD_MAX_LENGTH} characters`);
  }
  return password;
}
