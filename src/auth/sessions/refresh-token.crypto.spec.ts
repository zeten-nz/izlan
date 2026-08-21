import { generateRefreshTokenPlaintext, hashRefreshToken } from './refresh-token.crypto';

describe('refresh-token.crypto', () => {
  it('generates high-entropy opaque base64url token', () => {
    const t = generateRefreshTokenPlaintext();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
    // 32 bytes → base64url ~43 chars
    expect(t.length).toBeGreaterThanOrEqual(42);
    const t2 = generateRefreshTokenPlaintext();
    expect(t).not.toBe(t2); // tasodifiy
  });

  it('hash is deterministic sha256 hex', () => {
    const t = generateRefreshTokenPlaintext();
    expect(hashRefreshToken(t)).toBe(hashRefreshToken(t));
    expect(hashRefreshToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('plaintext != stored hash', () => {
    const t = generateRefreshTokenPlaintext();
    expect(hashRefreshToken(t)).not.toBe(t);
  });

  it('different tokens hash differently', () => {
    expect(hashRefreshToken(generateRefreshTokenPlaintext())).not.toBe(
      hashRefreshToken(generateRefreshTokenPlaintext()),
    );
  });
});
