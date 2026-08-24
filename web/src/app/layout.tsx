import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Manrope } from 'next/font/google';
import Script from 'next/script';
import { Providers } from './providers';

// Variable font with strong Uzbek Latin + Russian Cyrillic + English Latin coverage. Exposed as --font-sans.
const manrope = Manrope({ subsets: ['latin', 'cyrillic'], weight: ['400', '500', '600', '700', '800'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Izlan — Shaxsiy o‘rganish', template: '%s · Izlan' },
  description: 'Izlan — shaxsiylashtirilgan mustaqil o‘rganish. Darajangizni aniqlaymiz, sizga mos yo‘l xaritasi tuzamiz va har kuni aniq qadamlar bilan olg‘a boramiz.',
  applicationName: 'Izlan',
  openGraph: {
    title: 'Izlan — Shaxsiy o‘rganish',
    description: 'Shaxsiylashtirilgan mustaqil o‘rganish platformasi.',
    siteName: 'Izlan',
    type: 'website',
    locale: 'uz',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0d12' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uz" className={manrope.variable} suppressHydrationWarning>
      <body className="min-h-screen bg-bg text-text antialiased">
        <Script src="/theme-init.js" strategy="beforeInteractive" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
