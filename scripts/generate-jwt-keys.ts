import { generateKeyPairSync } from 'node:crypto';

/**
 * Developer JWT keypair generator (§5). PRODUCTION keys avtomatik startup'da YARATILMAYDI.
 * `npm run generate:jwt-keys [kid]` → env satrlarini stdout'ga chiqaradi (fayl yozmaydi).
 * Private key HECH QACHON commit qilinmaydi — output'ni xavfsiz secret store/env'ga qo'ying.
 * RSA 3072.
 */
const kid = process.argv[2] ?? `key-${new Date().toISOString().slice(0, 7)}`;
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

process.stdout.write(`AUTH_JWT_ACTIVE_KID=${kid}\n`);
process.stdout.write(`AUTH_JWT_PRIVATE_KEY_B64=${Buffer.from(privateKey).toString('base64')}\n`);
process.stdout.write(`AUTH_JWT_PUBLIC_KEYS_JSON=${JSON.stringify({ [kid]: Buffer.from(publicKey).toString('base64') })}\n`);
