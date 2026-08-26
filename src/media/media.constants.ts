/**
 * Lesson media V1 policy. Image + short audio only; standalone video/SVG/HTML/executables are rejected. Type is trusted
 * only after a magic-byte check (never the client-declared MIME or filename alone).
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MiB
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10 MiB
/** Hard streaming cap the multipart plugin enforces (the larger of the two; per-type limit is checked in the service). */
export const MAX_MEDIA_UPLOAD_BYTES = MAX_AUDIO_BYTES;
export const MAX_ALT_TEXT_LEN = 500;

// Strip control characters from alt text; keep normal punctuation/spaces. (Defined as a code-point set to avoid a
// control-character regex literal in source.)
function stripControl(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x20 && c !== 0x7f) out += ch;
  }
  return out;
}

/** Trim + strip control chars + cap length; empty → null. Alt text is stored per-attachment (ActivityMedia), not per-asset. */
export function normalizeAltText(alt: string | null | undefined): string | null {
  if (alt == null) return null;
  const cleaned = stripControl(alt).trim().slice(0, MAX_ALT_TEXT_LEN);
  return cleaned.length === 0 ? null : cleaned;
}

export const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const ALLOWED_AUDIO_MIME = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg'] as const;

export type MediaKind = 'image' | 'audio';

export function mediaKindForMime(mime: string): MediaKind | null {
  if ((ALLOWED_IMAGE_MIME as readonly string[]).includes(mime)) return 'image';
  if ((ALLOWED_AUDIO_MIME as readonly string[]).includes(mime)) return 'audio';
  return null;
}

export function maxBytesForKind(kind: MediaKind): number {
  return kind === 'image' ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;
}

const startsWith = (b: Buffer, sig: number[], offset = 0): boolean => sig.every((v, i) => b[offset + i] === v);
const ascii = (b: Buffer, s: string, offset = 0): boolean => startsWith(b, [...s].map((c) => c.charCodeAt(0)), offset);

/**
 * Confirm the raw bytes' magic number is consistent with the declared MIME (anti-spoofing, §8). Returns false for any
 * mismatch or unknown signature — the caller rejects with MEDIA_TYPE_NOT_ALLOWED.
 */
export function magicMatchesMime(mime: string, b: Buffer): boolean {
  if (b.length < 12) return false;
  switch (mime) {
    case 'image/png':
      return startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return startsWith(b, [0xff, 0xd8, 0xff]);
    case 'image/webp':
      return ascii(b, 'RIFF') && ascii(b, 'WEBP', 8);
    case 'audio/mpeg':
      return ascii(b, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0); // ID3 tag or MPEG frame sync
    case 'audio/wav':
    case 'audio/x-wav':
      return ascii(b, 'RIFF') && ascii(b, 'WAVE', 8);
    case 'audio/ogg':
      return ascii(b, 'OggS');
    default:
      return false;
  }
}
