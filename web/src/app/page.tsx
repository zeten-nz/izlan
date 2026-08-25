'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  FiActivity, FiArrowRight, FiBarChart2, FiBookOpen, FiCalendar, FiCheck, FiClock, FiGift,
  FiHelpCircle, FiLock, FiMap, FiMessageCircle, FiTarget, FiTrendingUp,
} from 'react-icons/fi';
import { useT } from '@/lib/i18n/i18n-context';
import { Button } from '@/components/ui';
import { LandingHeader } from '@/components/marketing/LandingHeader';
import { MaturityBadge } from '@/components/marketing/MaturityBadge';
import { fadeInUp } from '@/lib/motion/motion';

/** Scroll-reveal wrapper (respects reduced motion via the global MotionConfig). */
function Reveal({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div variants={fadeInUp} initial="initial" whileInView="animate" viewport={{ once: true, margin: '-60px' }} className={className}>
      {children}
    </motion.div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-bold uppercase tracking-[0.05em] text-primary">{children}</span>;
}

function Divider() {
  return <div className="mx-auto h-px w-full max-w-6xl bg-border" aria-hidden />;
}

/** A full-width section shell with consistent rhythm. `id` also gets scroll offset for the sticky header. */
function Band({ id, children, className = '' }: { id?: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${id ? 'scroll-mt-24' : ''} ${className}`}>
      {children}
    </section>
  );
}

/** Editorial column shared by the split rows. */
function Editorial({ eyebrow, title, body, maturity, children }: {
  eyebrow: string; title: string; body: string; maturity?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3.5">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="text-2xl font-bold leading-tight tracking-tight sm:text-[26px]">{title}</h2>
      <p className="leading-relaxed text-muted">{body}</p>
      {children}
      {maturity}
    </div>
  );
}

export default function LandingPage() {
  const t = useT();

  const SYSTEM = [
    { icon: FiTarget, label: t('landing.systemLevel') },
    { icon: FiTrendingUp, label: t('landing.systemProfile') },
    { icon: FiMap, label: t('landing.systemRoadmap') },
    { icon: FiCalendar, label: t('landing.systemPlan') },
    { icon: FiBarChart2, label: t('landing.systemResult') },
  ];
  const WHY = [t('landing.why1'), t('landing.why2'), t('landing.why3'), t('landing.why4'), t('landing.why5'), t('landing.why6')];

  return (
    <div className="min-h-screen bg-bg text-text">
      <LandingHeader />

      <main>
        {/* ── Hero ── */}
        <Band className="izl-grid-bg py-16 sm:py-24">
          <Reveal className="mx-auto flex max-w-2xl flex-col items-center gap-5 text-center">
            <span className="rounded-full bg-primary-tint px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.05em] text-primary">{t('landing.heroEyebrow')}</span>
            <h1 className="text-balance text-4xl font-extrabold leading-[1.12] tracking-tight sm:text-[44px]">{t('landing.heroTitle')}</h1>
            <p className="max-w-xl text-pretty text-lg leading-relaxed text-muted">{t('landing.heroSubtitle')}</p>
            <div className="mt-1 flex flex-col items-center gap-3 sm:flex-row">
              <Link href="/register"><Button size="lg" className="min-w-44">{t('landing.heroPrimary')}</Button></Link>
              <a href="#how-it-works"><Button variant="secondary" size="lg" className="min-w-44">{t('landing.heroSecondary')}</Button></a>
            </div>
            <span className="text-xs text-muted">{t('landing.heroNote')}</span>
          </Reveal>

          {/* Product-system visual — illustrative loop. The anchor target is a real region with an sr-only heading; the
              diagram itself is decorative (aria-hidden). */}
          <div id="how-it-works" className="scroll-mt-24">
            <h2 className="sr-only">{t('landing.navHow')}</h2>
            <Reveal className="mx-auto mt-12 max-w-3xl">
              <div className="rounded-2xl border border-border bg-surface p-5 izl-elevate-sm sm:p-6" aria-hidden>
                <ol className="flex items-center justify-between gap-1 overflow-x-auto">
                {SYSTEM.map((s, i) => {
                  const Icon = s.icon;
                  return (
                    <li key={s.label} className="flex items-center gap-1">
                      <div className="flex min-w-[92px] flex-col items-center gap-2 px-1 text-center">
                        <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary-tint text-primary"><Icon aria-hidden /></span>
                        <span className="text-[11.5px] font-bold">{s.label}</span>
                      </div>
                      {i < SYSTEM.length - 1 && <FiArrowRight className="shrink-0 text-border" aria-hidden />}
                    </li>
                  );
                })}
              </ol>
              </div>
            </Reveal>
          </div>
        </Band>

        <Divider />

        {/* ── Problem ── */}
        <Band className="py-16">
          <Reveal className="flex flex-col items-center gap-7 text-center">
            <div className="flex flex-col items-center gap-3">
              <Eyebrow>{t('landing.problemEyebrow')}</Eyebrow>
              <h2 className="max-w-xl text-2xl font-bold leading-snug tracking-tight sm:text-[26px]">{t('landing.problemTitle')}</h2>
            </div>
            <div className="grid w-full max-w-4xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[t('landing.problem1'), t('landing.problem2'), t('landing.problem3'), t('landing.problem4')].map((p) => (
                <div key={p} className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">{p}</div>
              ))}
            </div>
            <p className="font-bold">{t('landing.problemConclusion')}</p>
          </Reveal>
        </Band>

        <Divider />

        {/* ── Personalization / Skill profile (features anchor) ── */}
        <Band id="features" className="grid grid-cols-1 items-center gap-10 py-16 lg:grid-cols-2 lg:gap-14">
          <Reveal>
            <Editorial eyebrow={t('landing.personEyebrow')} title={t('landing.personTitle')} body={t('landing.personBody')} maturity={<MaturityBadge kind="available" />} />
          </Reveal>
          <Reveal>
            <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5" aria-hidden>
              {[['Grammar', 68], ['Vocabulary', 81], ['Listening', 42]].map(([name, pct]) => (
                <div key={name as string} className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-sm"><span className="font-semibold">{name}</span><span className="font-bold text-primary">{pct}%</span></div>
                  <div className="h-1.5 overflow-hidden rounded bg-surface-2"><div className="h-full rounded bg-primary" style={{ width: `${pct}%` }} /></div>
                </div>
              ))}
            </div>
          </Reveal>
        </Band>

        {/* ── Personal roadmap (visual left on desktop) ── */}
        <Band className="grid grid-cols-1 items-center gap-10 pb-16 lg:grid-cols-2 lg:gap-14">
          <Reveal className="lg:order-2">
            <Editorial eyebrow={t('landing.roadmapEyebrow')} title={t('landing.roadmapTitle')} body={t('landing.roadmapBody')} maturity={<MaturityBadge kind="available" />} />
          </Reveal>
          <Reveal className="lg:order-1">
            <div className="flex flex-col gap-1.5 rounded-2xl border border-border bg-surface p-5" aria-hidden>
              <div className="flex items-center gap-2.5 py-1.5"><FiCheck className="text-success" aria-hidden /><span className="text-[12.5px] text-muted line-through">Sentence structure</span></div>
              <div className="flex items-center gap-2.5 rounded-lg bg-primary-tint px-2 py-1.5"><span className="h-3.5 w-3.5 rounded-full border-2 border-primary" /><span className="text-[12.5px] font-bold">Present Simple</span></div>
              <div className="flex items-center gap-2.5 py-1.5"><span className="h-3.5 w-3.5 rounded-full border border-border" /><span className="text-[12.5px] text-muted">Questions &amp; Negatives</span></div>
              <div className="flex items-center gap-2.5 py-1.5"><FiLock className="text-muted" size={13} aria-hidden /><span className="text-[12.5px] text-muted">Frequency Adverbs</span></div>
            </div>
          </Reveal>
        </Band>

        <Divider />

        {/* ── Daily plan (workspace: core + recommended + extra) ── */}
        <Band className="grid grid-cols-1 items-center gap-10 py-16 lg:grid-cols-2 lg:gap-14">
          <Reveal>
            <Editorial eyebrow={t('landing.planEyebrow')} title={t('landing.planTitle')} body={t('landing.planBody')} maturity={<MaturityBadge kind="available" />}>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-primary-tint px-2.5 py-1 text-[11px] font-bold text-primary">{t('landing.planCore')}</span>
                <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-bold text-muted">{t('landing.planRecommended')}</span>
                <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-bold text-muted">{t('landing.planExtra')}</span>
              </div>
            </Editorial>
          </Reveal>
          <Reveal>
            <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5" aria-hidden>
              <div className="flex items-center justify-between"><span className="text-[11px] font-bold uppercase text-primary">{t('landing.systemPlan')}</span><span className="text-[11.5px] font-bold text-muted">2 / 4</span></div>
              <span className="text-lg font-bold">Present Simple</span>
              <div className="h-1.5 overflow-hidden rounded bg-surface-2"><div className="h-full w-1/2 rounded bg-primary" /></div>
              <span className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-[13px] font-bold text-primary-fg">{t('landing.systemPlan')} <FiArrowRight aria-hidden /></span>
            </div>
          </Reveal>
        </Band>

        {/* ── Learning + feedback (visual left) ── */}
        <Band className="grid grid-cols-1 items-center gap-10 pb-16 lg:grid-cols-2 lg:gap-14">
          <Reveal className="lg:order-2">
            <Editorial eyebrow={t('landing.learnEyebrow')} title={t('landing.learnTitle')} body={t('landing.learnBody')} maturity={<MaturityBadge kind="available" />} />
          </Reveal>
          <Reveal className="lg:order-1">
            <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5" aria-hidden>
              <span className="text-[12.5px] text-muted">Choose the correct sentence.</span>
              <div className="rounded-lg border-[1.5px] border-primary bg-primary-tint px-3.5 py-3 text-sm">He works every day.</div>
              <div className="rounded-lg border border-border px-3.5 py-3 text-sm text-muted">He work every day.</div>
            </div>
          </Reveal>
        </Band>

        <Divider />

        {/* ── Adaptive review ── */}
        <Band className="py-16">
          <Reveal className="flex flex-col items-center gap-6 text-center">
            <div className="flex flex-col items-center gap-3">
              <Eyebrow>{t('landing.reviewEyebrow')}</Eyebrow>
              <h2 className="max-w-xl text-2xl font-bold tracking-tight sm:text-[26px]">{t('landing.reviewTitle')}</h2>
              <p className="max-w-xl leading-relaxed text-muted">{t('landing.reviewBody')}</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row" aria-hidden>
              <div className="flex w-56 flex-col gap-1 rounded-xl border border-border bg-surface p-4"><span className="flex items-center gap-1.5 text-[12.5px] font-bold"><FiClock aria-hidden /> Grammar</span><span className="text-[11.5px] text-muted">Takrorlash tavsiya etiladi</span></div>
              <div className="flex w-56 flex-col gap-1 rounded-xl border border-border bg-surface p-4"><span className="flex items-center gap-1.5 text-[12.5px] font-bold"><FiCheck className="text-success" aria-hidden /> Vocabulary</span><span className="text-[11.5px] text-success">Yaxshi natija</span></div>
            </div>
            <MaturityBadge kind="available" />
          </Reveal>
        </Band>

        <Divider />

        {/* ── AI + Methodist (split maturity) ── */}
        <Band className="grid grid-cols-1 items-center gap-10 py-16 lg:grid-cols-2 lg:gap-14">
          <Reveal>
            <Editorial eyebrow={t('landing.aiEyebrow')} title={t('landing.aiTitle')} body={t('landing.aiBody')}>
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success-tint px-2.5 py-1 text-[11px] font-bold text-success">{t('landing.aiBadgeVerified')} · {t('landing.maturityAvailable')}</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-tint px-2.5 py-1 text-[11px] font-bold text-primary">{t('landing.aiBadgeChat')} · {t('landing.maturitySoon')}</span>
              </div>
            </Editorial>
          </Reveal>
          <Reveal>
            <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-surface p-5" aria-hidden>
              {['Bu mavzuni sodda tushuntir', 'Yana bir misol ber', 'Qayerda xato qildim?'].map((q) => (
                <div key={q} className="w-fit rounded-xl bg-surface-2 px-3.5 py-2.5 text-[12.5px]">{q}</div>
              ))}
            </div>
          </Reveal>
        </Band>

        <Divider />

        {/* ── Smart Library (Tez orada) ── */}
        <Band id="library" className="grid grid-cols-1 items-center gap-10 py-16 lg:grid-cols-2 lg:gap-14">
          <Reveal className="lg:order-2">
            <Editorial eyebrow={t('landing.libraryEyebrow')} title={t('landing.libraryTitle')} body={t('landing.libraryBody')} maturity={<MaturityBadge kind="soon" />} />
          </Reveal>
          <Reveal className="lg:order-1">
            <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5" aria-hidden>
              <span className="text-[13px] font-bold">War and Peace</span>
              <span className="text-xs leading-relaxed text-muted">…Pierre <span className="rounded bg-primary-tint px-1 text-primary">hesitated</span> as he entered the room and looked out of the window…</span>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-primary-tint px-2.5 py-1 text-[11px] font-bold text-primary">+ Lug‘atga qo‘shish</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-semibold text-muted"><FiBookOpen size={11} aria-hidden /> p. 148</span>
              </div>
            </div>
          </Reveal>
        </Band>

        {/* ── Personal dictionary / saved knowledge (Tez orada) ── */}
        <Band className="grid grid-cols-1 items-center gap-10 pb-16 lg:grid-cols-2 lg:gap-14">
          <Reveal>
            <Editorial eyebrow={t('landing.dictEyebrow')} title={t('landing.dictTitle')} body={t('landing.dictBody')} maturity={<MaturityBadge kind="soon" />} />
          </Reveal>
          <Reveal>
            <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-surface p-5" aria-hidden>
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5"><span className="text-[12.5px] font-semibold">hesitated</span><span className="text-[11px] text-muted">Lug‘at</span></div>
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5"><span className="text-[12.5px] font-semibold">1812 · Battle of Borodino</span><span className="text-[11px] text-muted">Sana</span></div>
            </div>
          </Reveal>
        </Band>

        <Divider />

        {/* ── Historical geography timeline (Rejada) ── */}
        <Band className="py-16">
          <Reveal className="flex flex-col items-center gap-6 text-center">
            <div className="flex flex-col items-center gap-3">
              <Eyebrow>{t('landing.mapEyebrow')}</Eyebrow>
              <h2 className="max-w-xl text-2xl font-bold tracking-tight sm:text-[26px]">{t('landing.mapTitle')}</h2>
            </div>
            <div className="flex w-full max-w-2xl flex-col gap-4 rounded-2xl border border-border bg-surface p-5" aria-hidden>
              <div className="grid h-44 place-items-center rounded-lg bg-surface-2 text-xs text-muted"><FiMap size={26} aria-hidden /></div>
              <div className="flex items-center gap-3">
                <span className="text-[11.5px] text-muted">1800</span>
                <div className="relative h-1 flex-1 rounded bg-border"><span className="absolute left-[38%] top-[-6px] h-4 w-4 rounded-full border-[3px] border-surface bg-primary" /></div>
                <span className="text-[11.5px] text-muted">1900</span>
              </div>
            </div>
            <MaturityBadge kind="planned" />
          </Reveal>
        </Band>

        <Divider />

        {/* ── Community (Tez orada, learning-first) ── */}
        <Band id="community" className="grid grid-cols-1 items-center gap-10 py-16 lg:grid-cols-2 lg:gap-14">
          <Reveal>
            <Editorial eyebrow={t('landing.communityEyebrow')} title={t('landing.communityTitle')} body={t('landing.communityBody')} maturity={<MaturityBadge kind="soon" />} />
          </Reveal>
          <Reveal>
            <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-surface p-5" aria-hidden>
              <span className="flex items-center gap-1.5 text-[12.5px] font-semibold"><FiHelpCircle aria-hidden /> “When is Present Perfect used?”</span>
              <div className="flex items-start gap-1.5 rounded-lg bg-surface-2 px-3 py-2.5 text-xs text-muted"><FiMessageCircle className="mt-0.5 shrink-0" size={13} aria-hidden /><span>When the result matters now — for example…</span></div>
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-success"><FiCheck aria-hidden /> Foydali javob</span>
            </div>
          </Reveal>
        </Band>

        <Divider />

        {/* ── Progress + XP + IZL ── */}
        <Band className="py-16">
          <Reveal className="flex flex-col items-center gap-8">
            <div className="flex max-w-xl flex-col items-center gap-2.5 text-center">
              <h2 className="text-2xl font-bold tracking-tight sm:text-[26px]">{t('landing.progressTitle')}</h2>
              <p className="text-muted">{t('landing.progressBody')}</p>
            </div>
            <div className="grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3" aria-hidden>
              <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5"><span className="flex items-center gap-1.5 text-xs font-bold text-muted"><FiTrendingUp aria-hidden /> {t('landing.progressStatSkill')}</span><span className="text-xl font-bold">68%</span><span className="text-[11.5px] text-muted">Grammar</span></div>
              <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5"><span className="flex items-center gap-1.5 text-xs font-bold text-muted"><FiMap aria-hidden /> {t('landing.progressStatRoadmap')}</span><span className="text-xl font-bold">12 / 36</span><span className="text-[11.5px] text-muted">{t('landing.progressStatRoadmapSub')}</span></div>
              <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5"><span className="flex items-center gap-1.5 text-xs font-bold text-muted"><FiBarChart2 aria-hidden /> {t('landing.progressStatLevel')}</span><span className="text-xl font-bold">Daraja 5</span><span className="text-[11.5px] text-muted">{t('landing.progressStatLevelSub')}</span></div>
            </div>
            {/* XP and IZL are DISTINCT — the note keeps them semantically separate, no cash-out/trade claim. */}
            <p className="max-w-xl text-center text-[11.5px] leading-relaxed text-muted">{t('landing.xpIzlNote')}</p>
          </Reveal>
        </Band>

        <Divider />

        {/* ── Why Izlan ── */}
        <Band className="py-14">
          <Reveal className="flex flex-col items-center gap-7">
            <span className="text-sm font-bold uppercase tracking-[0.05em] text-muted">{t('landing.whyTitle')}</span>
            <ol className="grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {WHY.map((w, i) => (
                <li key={w} className="flex items-center gap-2 text-center text-[13.5px] font-bold sm:justify-center">
                  <span className="text-primary">{`0${i + 1}`}</span><span>·</span><span>{w}</span>
                </li>
              ))}
            </ol>
          </Reveal>
        </Band>

        <Divider />

        {/* ── Subscription teaser (Tez orada; conceptual tiers, no prices) ── */}
        <Band id="plans" className="py-16">
          <Reveal className="flex flex-col items-center gap-6 text-center">
            <div className="flex flex-col items-center gap-3">
              <Eyebrow>{t('landing.plansEyebrow')}</Eyebrow>
              <h2 className="max-w-xl text-2xl font-bold tracking-tight sm:text-[26px]">{t('landing.plansTitle')}</h2>
              <MaturityBadge kind="soon" />
            </div>
            <div className="grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
              {[
                { name: t('landing.planStart'), desc: t('landing.planStartDesc'), rec: false },
                { name: t('landing.planPro'), desc: t('landing.planProDesc'), rec: true },
                { name: t('landing.planMax'), desc: t('landing.planMaxDesc'), rec: false },
              ].map((p) => (
                <div key={p.name} className={`flex flex-col gap-2 rounded-2xl bg-surface p-5 text-left ${p.rec ? 'border-[1.5px] border-primary' : 'border border-border'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-base font-bold">{p.name}</span>
                    {p.rec && <span className="rounded-full bg-primary-tint px-2 py-0.5 text-[10.5px] font-bold text-primary">{t('landing.planProBadge')}</span>}
                  </div>
                  <span className="text-[12.5px] text-muted">{p.desc}</span>
                </div>
              ))}
            </div>
            <a href="#plans"><Button variant="secondary" size="md">{t('landing.plansCta')}</Button></a>
          </Reveal>
        </Band>

        {/* ── Final CTA ── */}
        <section className="mt-8 bg-[rgb(24_27_34)] px-4 py-20 text-center sm:px-6">
          <Reveal className="mx-auto flex max-w-xl flex-col items-center gap-5">
            <h2 className="text-balance text-3xl font-extrabold leading-tight text-white">{t('landing.finalTitle')}</h2>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/register"><Button size="lg">{t('landing.finalPrimary')}</Button></Link>
              <Link href="/login"><Button variant="secondary" size="lg" className="border-white/25 bg-transparent text-white hover:bg-white/10">{t('landing.finalSecondary')}</Button></Link>
            </div>
          </Reveal>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-border bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-4 px-4 py-9 sm:flex-row sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="font-extrabold tracking-tight">{t('landing.brand')}</span>
            <span className="text-sm text-muted">· {t('landing.footerTagline')}</span>
          </div>
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 sm:ml-auto" aria-label={t('landing.menuLabel')}>
            <a href="#how-it-works" className="text-sm text-muted transition-colors hover:text-text">{t('landing.navHow')}</a>
            <a href="#features" className="text-sm text-muted transition-colors hover:text-text">{t('landing.navFeatures')}</a>
            <a href="#plans" className="text-sm text-muted transition-colors hover:text-text">{t('landing.navPlans')}</a>
            <Link href="/login" className="text-sm text-muted transition-colors hover:text-text">{t('landing.signIn')}</Link>
          </nav>
        </div>
        {/* Discreet, secondary staff access point (existing route) — kept below the learner-facing nav. */}
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 border-t border-border px-4 py-4 text-xs text-muted sm:px-6">
          <Link href="/staff/login" className="transition-colors hover:text-text">{t('landing.footerStaff')}</Link>
          <span>{t('landing.footerRights')}</span>
        </div>
      </footer>
    </div>
  );
}
