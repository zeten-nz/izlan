'use client';

import { ThemeSwitcher } from '@/components/ui/theme-switcher';

/**
 * Auth header theme control. Thin wrapper — the shared {@link ThemeSwitcher} (00 — Foundations) is the behavior
 * authority; Auth simply consumes it so the frozen header stays visually identical. Kept as a named seam in case
 * Auth ever needs header-specific sizing/layout.
 */
export function AuthThemeSwitcher() {
  return <ThemeSwitcher />;
}
