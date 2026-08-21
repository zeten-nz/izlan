import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import type { JwtConfig } from '../../config/env.validation';
import { AccessTokenInvalidError } from '../../common/errors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VerifiedPrincipal {
  userId: string;
  sessionId: string;
}

/**
 * AccessTokenService — RS256 issue/verify (§9, TD-owner). DB query YO'Q (session/account live-check guard'da).
 * kid → public key map (rotation-ready). Algorithm confusion (HS256) qat'iy bloklanadi.
 * Minimal claims (§7): sub, sid, typ, iss, aud, iat, exp. Phone/role/permission YO'Q.
 */
@Injectable()
export class AccessTokenService {
  private readonly cfg: JwtConfig;

  constructor(config: ConfigService) {
    this.cfg = config.getOrThrow<JwtConfig>('jwt');
  }

  issueAccessToken(userId: string, sessionId: string): { token: string; expiresIn: number } {
    const token = jwt.sign({ sid: sessionId, typ: 'access' }, this.cfg.privateKeyPem, {
      algorithm: 'RS256',
      keyid: this.cfg.activeKid,
      subject: userId,
      issuer: this.cfg.issuer,
      audience: this.cfg.audience,
      expiresIn: this.cfg.accessTtlSeconds,
    });
    return { token, expiresIn: this.cfg.accessTtlSeconds };
  }

  verifyAccessToken(token: string): VerifiedPrincipal {
    // 1) header'dan kid — verification key tanlash (unknown kid → reject).
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === 'string') throw new AccessTokenInvalidError('malformed');
    const kid = decoded.header.kid;
    if (!kid || !this.cfg.publicKeysPem[kid]) throw new AccessTokenInvalidError('unknown kid');

    // 2) verify — RS256 ONLY (algorithm confusion block), issuer/audience/exp/signature.
    let payload: jwt.JwtPayload | string;
    try {
      payload = jwt.verify(token, this.cfg.publicKeysPem[kid], {
        algorithms: ['RS256'],
        issuer: this.cfg.issuer,
        audience: this.cfg.audience,
      });
    } catch {
      throw new AccessTokenInvalidError('verification failed');
    }
    if (typeof payload === 'string') throw new AccessTokenInvalidError('invalid payload');

    // 3) claim shape.
    if (payload.typ !== 'access') throw new AccessTokenInvalidError('wrong token type');
    const sub = payload.sub;
    const sid = payload.sid;
    if (typeof sub !== 'string' || !UUID_RE.test(sub)) throw new AccessTokenInvalidError('invalid sub');
    if (typeof sid !== 'string' || !UUID_RE.test(sid)) throw new AccessTokenInvalidError('invalid sid');

    return { userId: sub, sessionId: sid };
  }
}
