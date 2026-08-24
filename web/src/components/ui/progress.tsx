'use client';

import { FiCheck } from 'react-icons/fi';

/** Clamp a value/max pair to a 0–100 percentage (guards NaN, negatives, over-max, max<=0). */
export function clampPercent(value: number, max = 100): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

const FILL = 'h-full rounded-[4px] bg-primary transition-[width] duration-500 motion-reduce:transition-none';
const TRACK = 'h-1.5 w-full overflow-hidden rounded-[4px] bg-surface-2';

/**
 * Linear determinate progress bar. Presentation only. `aria-valuenow` carries the meaning, so it is never
 * color-only; pass a `label` (also used as the accessible name) and optionally show the numeric value.
 */
export function LinearProgress({
  value,
  max = 100,
  label,
  showValue = false,
  className = '',
}: {
  value: number;
  max?: number;
  label?: string;
  showValue?: boolean;
  className?: string;
}) {
  const pct = clampPercent(value, max);
  const rounded = Math.round(pct);
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {(label || showValue) && (
        <div className="flex items-center justify-between text-xs">
          {label ? <span className="font-medium text-text">{label}</span> : <span />}
          {showValue && <span className="font-semibold text-muted">{rounded}%</span>}
        </div>
      )}
      <div role="progressbar" aria-valuenow={rounded} aria-valuemin={0} aria-valuemax={100} aria-label={label} className={TRACK}>
        <div className={FILL} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * Step progress (e.g. Profil — Yo'nalish — Daraja). Done steps carry a check icon (not color-only); the current
 * step is exposed via `aria-current="step"`. `current` is the 0-based index of the active step.
 */
export function StepProgress({ steps, current, className = '' }: { steps: string[]; current: number; className?: string }) {
  return (
    <ol className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold ${className}`} aria-label="progress">
      {steps.map((label, i) => {
        const done = i < current;
        const isCurrent = i === current;
        return (
          <li key={label} className="flex items-center" aria-current={isCurrent ? 'step' : undefined}>
            {i > 0 && (
              <span aria-hidden className="mr-2 text-border">
                —
              </span>
            )}
            <span className={`inline-flex items-center gap-1 ${done ? 'text-success' : isCurrent ? 'text-primary' : 'text-muted'}`}>
              {done && <FiCheck aria-hidden />}
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Mastery indicator — a labelled skill/percentage bar. Same visual language as LinearProgress but pairs the bar
 * with a name and an optional qualitative level (e.g. "Yaxshi"), surfaced to AT via `aria-valuetext`.
 */
export function MasteryProgress({
  value,
  max = 100,
  label,
  levelLabel,
  className = '',
}: {
  value: number;
  max?: number;
  label: string;
  levelLabel?: string;
  className?: string;
}) {
  const pct = clampPercent(value, max);
  const rounded = Math.round(pct);
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex items-center justify-between text-[13px]">
        <span className="font-medium text-text">{label}</span>
        <span className="font-semibold text-primary">{levelLabel ?? `${rounded}%`}</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={rounded}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        aria-valuetext={levelLabel ? `${rounded}% — ${levelLabel}` : `${rounded}%`}
        className={TRACK}
      >
        <div className={FILL} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
