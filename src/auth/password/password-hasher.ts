import { Injectable } from '@nestjs/common';
import { Algorithm, hash, verify } from '@node-rs/argon2';

/**
 * ONE password-hashing port (TD-252). Argon2id via a maintained prebuilt implementation. Callers use this port —
 * never call argon2 directly. Stores/returns ONLY the encoded PHC hash (algorithm + params + salt embedded); no
 * plaintext, no separate salt. `verify` never throws — a malformed/incompatible hash is simply "no match".
 */
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(encodedHash: string, plain: string): Promise<boolean>;
}

// OWASP Argon2id baseline: 19 MiB memory, 2 iterations, 1 lane.
const OPTS = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  hash(plain: string): Promise<string> {
    return hash(plain, OPTS);
  }

  async verify(encodedHash: string, plain: string): Promise<boolean> {
    try {
      return await verify(encodedHash, plain);
    } catch {
      return false;
    }
  }
}
