'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { FiArrowRight, FiActivity, FiCalendar, FiCompass, FiEdit3, FiLayers, FiTarget, FiTrendingUp } from 'react-icons/fi';
import { useT } from '@/lib/i18n/i18n-context';
import { Button } from '@/components/ui';
import { PublicHeader } from '@/components/learner/PublicHeader';
import { fadeInUp } from '@/lib/motion/motion';

function Section({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.section
      variants={fadeInUp}
      initial="initial"
      whileInView="animate"
      viewport={{ once: true, margin: '-80px' }}
      className={`mx-auto w-full max-w-6xl px-4 ${className}`}
    >
      {children}
    </motion.section>
  );
}

const LOOP = [
  { icon: FiTarget, t: 'loop1Title', b: 'loop1Body' },
  { icon: FiCompass, t: 'loop2Title', b: 'loop2Body' },
  { icon: FiCalendar, t: 'loop3Title', b: 'loop3Body' },
  { icon: FiEdit3, t: 'loop4Title', b: 'loop4Body' },
  { icon: FiTrendingUp, t: 'loop5Title', b: 'loop5Body' },
] as const;

const FEATURES = [
  { icon: FiActivity, t: 'adaptTitle', b: 'adaptBody' },
  { icon: FiEdit3, t: 'testsTitle', b: 'testsBody' },
  { icon: FiLayers, t: 'subjectsTitle', b: 'subjectsBody' },
  { icon: FiTrendingUp, t: 'progressTitle', b: 'progressBody' },
] as const;

/** Public Izlan landing page (Phase 3.0). Positions Izlan as personalized self-study — not an online school or course store. */
export default function LandingPage() {
  const t = useT();
  return (
    <div className="min-h-screen bg-bg text-text">
      <PublicHeader
        cta={
          <Link href="/login" className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:text-text">
            {t('landing.signIn')}
          </Link>
        }
      />

      {/* Hero */}
      <Section className="izl-grid-bg py-16 text-center sm:py-24">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-balance text-4xl font-bold leading-tight tracking-tight sm:text-6xl">{t('landing.heroTitle')}</h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted">{t('landing.heroSubtitle')}</p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/register">
              <Button size="md" className="min-w-44">
                {t('landing.heroPrimary')}
              </Button>
            </Link>
            <a href="#loop">
              <Button variant="secondary" size="md" className="min-w-44">
                {t('landing.heroSecondary')}
              </Button>
            </a>
          </div>
        </div>
      </Section>

      {/* Learning loop */}
      <Section className="py-14" >
        <div id="loop" className="scroll-mt-20 text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('landing.loopTitle')}</h2>
          <p className="mx-auto mt-3 max-w-2xl text-muted">{t('landing.loopSubtitle')}</p>
        </div>
        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {LOOP.map((s, i) => {
            const Icon = s.icon;
            return (
              <li key={s.t} className="rounded-card border border-border bg-surface p-5">
                <div className="flex items-center gap-2 text-primary">
                  <Icon className="text-xl" aria-hidden />
                  <span className="text-xs font-semibold text-muted">0{i + 1}</span>
                </div>
                <h3 className="mt-3 font-semibold">{t(`landing.${s.t}`)}</h3>
                <p className="mt-1 text-sm text-muted">{t(`landing.${s.b}`)}</p>
              </li>
            );
          })}
        </ol>
      </Section>

      {/* Feature grid */}
      <Section className="py-14">
        <div className="grid gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.t} className="rounded-card border border-border bg-surface p-6 izl-elevate-sm">
                <Icon className="text-2xl text-primary" aria-hidden />
                <h3 className="mt-4 text-lg font-semibold">{t(`landing.${f.t}`)}</h3>
                <p className="mt-2 text-muted">{t(`landing.${f.b}`)}</p>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Final CTA */}
      <Section className="py-16">
        <div className="rounded-card border border-border bg-surface-2 px-6 py-14 text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('landing.ctaTitle')}</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted">{t('landing.ctaBody')}</p>
          <Link href="/register" className="mt-8 inline-block">
            <Button size="md" leftIcon={<FiArrowRight aria-hidden />}>{t('landing.ctaButton')}</Button>
          </Link>
        </div>
      </Section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-muted sm:flex-row">
          <div>
            <span className="font-semibold text-text">{t('landing.brand')}</span> · {t('landing.footerTagline')}
          </div>
          <div className="flex items-center gap-4">
            <Link href="/staff/login" className="transition-colors hover:text-text">
              {t('landing.footerStaff')}
            </Link>
            <span>{t('landing.footerRights')}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
