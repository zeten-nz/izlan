'use client';

import { useT } from '@/lib/i18n/i18n-context';

export type RailVariant = 'login' | 'registerPhone' | 'otp' | 'createPassword' | 'forgot' | 'resetSuccess';

// Three milestone nodes along the path (viewBox 0 0 380 460). active index: 0 start · 1 mid · 2 end.
const NODES: Array<[number, number]> = [
  [40, 420],
  [150, 270],
  [300, 70],
];

const CONFIG: Record<RailVariant, { active: 0 | 1 | 2; cards: boolean; labels: boolean; key: string }> = {
  login: { active: 0, cards: true, labels: true, key: 'login' },
  registerPhone: { active: 0, cards: true, labels: false, key: 'registerPhone' },
  otp: { active: 1, cards: false, labels: false, key: 'otp' },
  createPassword: { active: 2, cards: false, labels: false, key: 'createPassword' },
  forgot: { active: 0, cards: false, labels: false, key: 'forgot' },
  resetSuccess: { active: 2, cards: false, labels: false, key: 'resetSuccess' },
};

/**
 * Dark marketing / progress rail shown beside the auth form on wide screens. Always dark (bg-panel) regardless of app
 * theme. Hidden below `lg` so the form stays centered and readable with no horizontal scroll on narrow viewports.
 */
export function AuthLearningRail({ variant }: { variant: RailVariant }) {
  const t = useT();
  const cfg = CONFIG[variant];

  return (
    <aside className="relative hidden w-[420px] shrink-0 flex-col justify-between overflow-hidden bg-panel p-11 text-white xl:w-[460px] lg:flex">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-white/45">{t('authui.rail.eyebrow')}</p>

      <div className="relative my-8 min-h-[280px] flex-1">
        <svg viewBox="0 0 380 460" fill="none" className="absolute inset-0 h-full w-full" aria-hidden>
          <path
            d="M40 420 C 120 380 70 300 150 270 C 250 235 210 130 300 70"
            stroke="rgba(255,255,255,0.22)"
            strokeWidth={2}
            strokeLinecap="round"
          />
          <circle cx={225} cy={170} r={4} stroke="rgba(255,255,255,0.3)" strokeWidth={1.5} fill="none" />
          {NODES.map(([cx, cy], i) =>
            i === cfg.active ? (
              <circle key={i} cx={cx} cy={cy} r={7} className="fill-primary" />
            ) : (
              <circle key={i} cx={cx} cy={cy} r={5.5} className="fill-panel" stroke="#fff" strokeWidth={2} />
            ),
          )}
          {cfg.labels && (
            <g fill="rgba(255,255,255,0.62)" fontSize={11} fontWeight={600}>
              <text x={55} y={425}>
                {t('authui.rail.nodeStart')}
              </text>
              <text x={165} y={265}>
                {t('authui.rail.nodePractice')}
              </text>
              <text x={235} y={65}>
                {t('authui.rail.nodeAchieve')}
              </text>
            </g>
          )}
        </svg>

        {cfg.cards && (
          <div className="absolute right-0 top-4 flex w-[190px] flex-col gap-3">
            <RailCard title={t(`authui.rail.${cfg.key}Card1Title`)} sub={t(`authui.rail.${cfg.key}Card1Sub`)} />
            <RailCard title={t(`authui.rail.${cfg.key}Card2Title`)} sub={t(`authui.rail.${cfg.key}Card2Sub`)} />
          </div>
        )}
      </div>

      <div>
        <h2 className="text-[19px] font-bold leading-[1.3]">{t(`authui.rail.${cfg.key}Title`)}</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-white/55">{t(`authui.rail.${cfg.key}Body`)}</p>
      </div>
    </aside>
  );
}

function RailCard({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="rounded-xl border border-white/[0.14] bg-white/[0.06] px-3.5 py-3 backdrop-blur-sm">
      <p className="text-xs font-bold text-white">{title}</p>
      <p className="mt-0.5 text-[11px] text-white/50">{sub}</p>
    </div>
  );
}
