import { randomBytes, createHash } from 'node:crypto';

/**
 * Opaque refresh token kriptografiyasi (§26). JWT EMAS.
 * - plaintext: 32 tasodifiy bayt (256-bit entropy), base64url — URL/cookie-safe.
 * - hash: SHA-256 (yuqori entropiya tufayli HMAC shart emas). DB faqat hash saqlaydi.
 * Plaintext faqat caller'ga bir marta qaytariladi; hech qachon log qilinmaydi.
 */
export function generateRefreshTokenPlaintext(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}
