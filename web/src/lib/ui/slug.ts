/**
 * Slug helpers for Content Studio. `slugify` derives a backend-valid slug from a human title so ordinary staff never
 * hit the lowercase/kebab validation error by typing "Tarix Fani"; `isValidSlug` mirrors the server's SLUG_RE so the
 * form can explain the real problem before submit. The server remains authoritative — this only improves the UX.
 */

/** Mirrors the backend `SLUG_RE` (src/content-authoring/dto/common.dto.ts): lowercase alphanumeric kebab-case. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

/**
 * Derive a valid slug from arbitrary text: lowercase, trim, drop characters outside [a-z0-9], collapse runs of
 * spaces/hyphens to a single hyphen, and strip leading/trailing hyphens. "Tarix Fani" → "tarix-fani".
 * Non-Latin input (e.g. Cyrillic) has no Latin letters to keep and yields "" — the field then asks the user to type one.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // keep only slug-safe characters + separators
    .replace(/[\s-]+/g, '-') // any run of spaces/hyphens → one hyphen
    .replace(/^-+|-+$/g, ''); // no leading/trailing hyphen
}
