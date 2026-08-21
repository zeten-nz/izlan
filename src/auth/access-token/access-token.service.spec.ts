import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { AccessTokenService } from './access-token.service';
import { AccessTokenInvalidError } from '../../common/errors';
import type { JwtConfig } from '../../config/env.validation';

function makeKeys() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function makeService(overrides: Partial<JwtConfig> = {}): { svc: AccessTokenService; cfg: JwtConfig } {
  const { privateKey, publicKey } = makeKeys();
  const kid = 'key-1';
  const cfg: JwtConfig = {
    activeKid: kid,
    privateKeyPem: privateKey,
    publicKeysPem: { [kid]: publicKey },
    issuer: 'izlan-test',
    audience: 'izlan-web',
    accessTtlSeconds: 900,
    ...overrides,
  };
  const config = { getOrThrow: () => cfg } as unknown as ConfigService;
  return { svc: new AccessTokenService(config), cfg };
}

describe('AccessTokenService', () => {
  const userId = randomUUID();
  const sessionId = randomUUID();

  it('RS256 sign + verify roundtrip with exact claims', () => {
    const { svc } = makeService();
    const { token } = svc.issueAccessToken(userId, sessionId);
    const principal = svc.verifyAccessToken(token);
    expect(principal).toEqual({ userId, sessionId });
    const decoded = jwt.decode(token, { complete: true });
    expect(decoded && typeof decoded !== 'string' && decoded.header.alg).toBe('RS256');
    expect(decoded && typeof decoded !== 'string' && decoded.header.kid).toBe('key-1');
    const payload = (decoded as jwt.Jwt).payload as jwt.JwtPayload;
    expect(payload.typ).toBe('access');
    expect(payload.iss).toBe('izlan-test');
    expect(payload.aud).toBe('izlan-web');
  });

  it('rejects expired token', () => {
    const { svc, cfg } = makeService();
    const token = jwt.sign({ sid: sessionId, typ: 'access' }, cfg.privateKeyPem, {
      algorithm: 'RS256', keyid: cfg.activeKid, subject: userId, issuer: cfg.issuer, audience: cfg.audience, expiresIn: -10,
    });
    expect(() => svc.verifyAccessToken(token)).toThrow(AccessTokenInvalidError);
  });

  it('rejects wrong issuer / audience', () => {
    const { svc, cfg } = makeService();
    const badIss = jwt.sign({ sid: sessionId, typ: 'access' }, cfg.privateKeyPem, {
      algorithm: 'RS256', keyid: cfg.activeKid, subject: userId, issuer: 'evil', audience: cfg.audience, expiresIn: 900,
    });
    expect(() => svc.verifyAccessToken(badIss)).toThrow(AccessTokenInvalidError);
    const badAud = jwt.sign({ sid: sessionId, typ: 'access' }, cfg.privateKeyPem, {
      algorithm: 'RS256', keyid: cfg.activeKid, subject: userId, issuer: cfg.issuer, audience: 'evil', expiresIn: 900,
    });
    expect(() => svc.verifyAccessToken(badAud)).toThrow(AccessTokenInvalidError);
  });

  it('rejects unknown kid', () => {
    const { svc, cfg } = makeService();
    const token = jwt.sign({ sid: sessionId, typ: 'access' }, cfg.privateKeyPem, {
      algorithm: 'RS256', keyid: 'unknown-kid', subject: userId, issuer: cfg.issuer, audience: cfg.audience, expiresIn: 900,
    });
    expect(() => svc.verifyAccessToken(token)).toThrow(/unknown kid/);
  });

  it('rejects wrong typ', () => {
    const { svc, cfg } = makeService();
    const token = jwt.sign({ sid: sessionId, typ: 'refresh' }, cfg.privateKeyPem, {
      algorithm: 'RS256', keyid: cfg.activeKid, subject: userId, issuer: cfg.issuer, audience: cfg.audience, expiresIn: 900,
    });
    expect(() => svc.verifyAccessToken(token)).toThrow(/wrong token type/);
  });

  it('rejects altered token (bad signature)', () => {
    const { svc } = makeService();
    const { token } = svc.issueAccessToken(userId, sessionId);
    const parts = token.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${'A'.repeat(parts[2].length)}`;
    expect(() => svc.verifyAccessToken(tampered)).toThrow(AccessTokenInvalidError);
  });

  it('blocks algorithm confusion (HS256 signed with public key as secret)', () => {
    const { svc, cfg } = makeService();
    const publicPem = cfg.publicKeysPem[cfg.activeKid];
    const forged = jwt.sign({ sid: sessionId, typ: 'access' }, publicPem, {
      algorithm: 'HS256', keyid: cfg.activeKid, subject: userId, issuer: cfg.issuer, audience: cfg.audience, expiresIn: 900,
    });
    expect(() => svc.verifyAccessToken(forged)).toThrow(AccessTokenInvalidError);
  });

  it('rejects malformed token', () => {
    const { svc } = makeService();
    expect(() => svc.verifyAccessToken('not.a.jwt')).toThrow(AccessTokenInvalidError);
    expect(() => svc.verifyAccessToken('garbage')).toThrow(AccessTokenInvalidError);
  });
});
