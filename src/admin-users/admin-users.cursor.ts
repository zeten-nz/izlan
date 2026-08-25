import { BadRequestException } from '@nestjs/common';

/**
 * Opaque keyset cursor for the admin user list. Encodes the last row's (createdAt, id) so the next page continues
 * deterministically under the fixed `(createdAt DESC, id DESC)` order — no offset, no unbounded scan, no dup/skip on
 * equal timestamps (id is unique). The client must treat it as opaque; a malformed cursor is a deterministic 400.
 */
export interface UserCursor {
  createdAt: string; // ISO-8601
  id: string;
}

export function encodeUserCursor(row: { createdAt: Date; id: string }): string {
  const json = JSON.stringify({ c: row.createdAt.toISOString(), i: row.id });
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeUserCursor(cursor: string): UserCursor {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const obj = JSON.parse(json) as { c?: unknown; i?: unknown };
    if (typeof obj.c !== 'string' || typeof obj.i !== 'string') throw new Error('shape');
    if (Number.isNaN(new Date(obj.c).getTime())) throw new Error('date');
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(obj.i)) throw new Error('id');
    return { createdAt: obj.c, id: obj.i };
  } catch {
    throw new BadRequestException({ code: 'ADMIN_USERS_INVALID_CURSOR', message: 'invalid cursor' });
  }
}
