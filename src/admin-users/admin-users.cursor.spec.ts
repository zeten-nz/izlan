import { BadRequestException } from '@nestjs/common';
import { decodeUserCursor, encodeUserCursor } from './admin-users.cursor';

const codeOf = (e: unknown): string | undefined => {
  if (e instanceof BadRequestException) {
    const r = e.getResponse();
    return typeof r === 'object' && r !== null ? (r as { code?: string }).code : undefined;
  }
  return undefined;
};

describe('admin users keyset cursor (Phase 07C1)', () => {
  const id = '01a0346f-7968-73c4-9411-6e8c905ea600';

  it('ADMINUSERS-CUR-01 round-trips (createdAt, id)', () => {
    const createdAt = new Date('2026-08-25T10:00:00.000Z');
    const dec = decodeUserCursor(encodeUserCursor({ createdAt, id }));
    expect(dec.createdAt).toBe(createdAt.toISOString());
    expect(dec.id).toBe(id);
  });

  it('ADMINUSERS-CUR-02 is opaque (base64url; no readable JSON keys)', () => {
    const enc = encodeUserCursor({ createdAt: new Date('2026-01-01T00:00:00.000Z'), id });
    expect(enc).not.toContain('{');
    expect(enc).not.toContain('createdAt');
    expect(enc).not.toContain(id);
  });

  it('ADMINUSERS-CUR-03 a malformed cursor throws a deterministic 400 (ADMIN_USERS_INVALID_CURSOR)', () => {
    const bad = [
      'not-base64-!!!',
      '',
      Buffer.from('garbage-not-json').toString('base64url'),
      Buffer.from(JSON.stringify({ c: 'not-a-date', i: id })).toString('base64url'),
      Buffer.from(JSON.stringify({ c: new Date().toISOString(), i: 'not-a-uuid' })).toString('base64url'),
      Buffer.from(JSON.stringify({ c: new Date().toISOString() })).toString('base64url'),
    ];
    for (const b of bad) {
      let thrown: unknown;
      try {
        decodeUserCursor(b);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(BadRequestException);
      expect(codeOf(thrown)).toBe('ADMIN_USERS_INVALID_CURSOR');
    }
  });
});
