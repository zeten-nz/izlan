/**
 * Permission code registry (TD-26/90). Canonical kodlar application'da; RolePermission mapping DB'da.
 * To'liq katalog hali OPEN — 100 permission INVENT QILINMAYDI (§8).
 * Phase 1.4B'da himoyalangan business endpoint yo'q → registry minimal.
 * Format konventsiyasi: `<domain>.<resource>.<action>` (kelajak qo'shimchalar uchun).
 */

// Hozircha misol/struktura sifatida bo'sh boshlanadi; kodlar tegishli modul implement qilinganda qo'shiladi.
export const KNOWN_PERMISSIONS = [] as const;

export type PermissionCode = string;

const registry = new Set<string>(KNOWN_PERMISSIONS);

/** Kelajak modullari o'z permission kodlarini ro'yxatga qo'shadi (masalan content module bootstrap). */
export function registerPermissions(codes: readonly string[]): void {
  for (const c of codes) registry.add(c);
}

export function isKnownPermission(code: string): boolean {
  return registry.has(code);
}

export function knownPermissions(): string[] {
  return [...registry];
}
