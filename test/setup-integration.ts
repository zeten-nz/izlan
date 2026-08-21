import 'dotenv/config';

/**
 * Integration test guard (§43/44). izlan_dev CASUAL ishlatilmaydi — izolyatsiyalangan izlan_test majburiy.
 * DATABASE_URL → TEST_DATABASE_URL override; NODE_ENV=test.
 * Test tuning: cooldown default (60s) qoldiriladi; boshqa qiymatlar default.
 */
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !/izlan_test/.test(testUrl)) {
  throw new Error('TEST_DATABASE_URL must be set and point to an izlan_test database');
}
process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';
// Auth pepper test uchun kafolatlangan (agar .env'da bo'lmasa)
process.env.AUTH_OTP_PEPPER = process.env.AUTH_OTP_PEPPER ?? 'integration-test-pepper-0123456789abcdef';

// JWT test keys (test-only fixture — production key EMAS). Dev keys'dan izolyatsiya.
import { TEST_JWT_ACTIVE_KID, TEST_JWT_PRIVATE_KEY_B64, TEST_JWT_PUBLIC_KEYS_JSON } from './fixtures/jwt-test-keys';
process.env.AUTH_JWT_ACTIVE_KID = TEST_JWT_ACTIVE_KID;
process.env.AUTH_JWT_PRIVATE_KEY_B64 = TEST_JWT_PRIVATE_KEY_B64;
process.env.AUTH_JWT_PUBLIC_KEYS_JSON = TEST_JWT_PUBLIC_KEYS_JSON;
process.env.AUTH_JWT_ISSUER = 'izlan-test';
process.env.AUTH_JWT_AUDIENCE = 'izlan-web-test';
process.env.AUTH_COOKIE_SECURE = 'false';
process.env.CORS_ORIGINS = 'http://localhost:3001';
// HTTP e2e ko'p login qiladi; per-IP limiter in-memory (cleanup qilmaydi) — test uchun yuqori.
process.env.AUTH_OTP_IP_HOURLY_LIMIT = '1000';
