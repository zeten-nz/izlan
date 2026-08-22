import { Argon2PasswordHasher } from './password-hasher';
import { assertPasswordPolicy, PASSWORD_MAX_LENGTH } from './password-policy';
import { PasswordPolicyError } from '../../common/errors';

describe('Argon2PasswordHasher + password policy (TD-252)', () => {
  const hasher = new Argon2PasswordHasher();
  const PW = 'Passw0rd!123';

  it('PWD-01 hash is not the plaintext (encoded Argon2id PHC string)', async () => {
    const h = await hasher.hash(PW);
    expect(h).not.toContain(PW);
    expect(h.startsWith('$argon2id$')).toBe(true);
  });

  it('PWD-02 correct password verifies', async () => {
    const h = await hasher.hash(PW);
    expect(await hasher.verify(h, PW)).toBe(true);
  });

  it('PWD-03 wrong password fails (and a malformed hash never throws)', async () => {
    const h = await hasher.hash(PW);
    expect(await hasher.verify(h, 'not-the-password')).toBe(false);
    expect(await hasher.verify('not-a-valid-hash', PW)).toBe(false);
  });

  it('PWD-04 the same password hashed twice yields different (salted) hashes, both verifying', async () => {
    const a = await hasher.hash(PW);
    const b = await hasher.hash(PW);
    expect(a).not.toBe(b);
    expect(await hasher.verify(a, PW)).toBe(true);
    expect(await hasher.verify(b, PW)).toBe(true);
  });

  it('PWD-05 length policy enforced (8..128, no trimming)', () => {
    expect(() => assertPasswordPolicy('short')).toThrow(PasswordPolicyError); // < 8
    expect(() => assertPasswordPolicy('x'.repeat(PASSWORD_MAX_LENGTH + 1))).toThrow(PasswordPolicyError); // > 128
    expect(assertPasswordPolicy('12345678')).toBe('12345678'); // exactly 8 ok
    expect(assertPasswordPolicy(' 8spaces')).toBe(' 8spaces'); // whitespace significant, not trimmed
    expect(assertPasswordPolicy('x'.repeat(PASSWORD_MAX_LENGTH))).toHaveLength(PASSWORD_MAX_LENGTH); // exactly 128 ok
  });
});
