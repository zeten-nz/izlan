import './globals.css';
import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Izlan Studio — Kontent CMS',
  description: 'Izlan metodist kontent boshqaruv tizimi',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uz" suppressHydrationWarning>
      <body className="min-h-screen bg-bg text-text antialiased">
        <Script src="/theme-init.js" strategy="beforeInteractive" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
