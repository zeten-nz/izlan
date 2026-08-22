'use client';

import type { ReactNode } from 'react';
import { MotionConfig } from 'framer-motion';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { AuthProvider } from '@/lib/auth/auth-context';
import { ToastProvider } from '@/components/ui/toast';

/** App-wide client providers. CmsProvider is mounted deeper (inside the authenticated /staff/content layout). */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>
        {/* reducedMotion="user" → all Framer Motion respects the OS "reduce motion" setting automatically. */}
        <MotionConfig reducedMotion="user">
          <ToastProvider>
            <AuthProvider>{children}</AuthProvider>
          </ToastProvider>
        </MotionConfig>
      </I18nProvider>
    </ThemeProvider>
  );
}
