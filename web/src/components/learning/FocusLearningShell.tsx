'use client';

import { FiX } from 'react-icons/fi';
import { useT } from '@/lib/i18n/i18n-context';
import { ThemeSwitcher, clampPercent } from '@/components/ui';

/** The two-square Izlan brand mark, compact for the focus top bar. */
function BrandMark() {
  return (
    <span className="relative inline-block h-[22px] w-[22px]" aria-hidden>
      <span className="absolute left-0 top-0 h-[14px] w-[14px] rounded-[4px] bg-primary" />
      <span className="absolute bottom-0 right-0 h-[11px] w-[11px] rounded-full border-2 border-primary bg-surface" />
    </span>
  );
}

/**
 * Distraction-reduced shell for focused learner tasks (Placement now; Lesson Execution + Review later). A thin top
 * bar carries the Izlan identity, a concise context label, the shared ThemeSwitcher and an optional exit; an optional
 * slim progress bar sits under it. No learner sidebar. Theme-aware (Light/Dark/System) via the shared foundation.
 * The shell is intentionally domain-agnostic — callers pass context/progress/exit; it knows nothing about Placement.
 */
export function FocusLearningShell({
  title,
  context,
  progress,
  progressLabel,
  progressText,
  onExit,
  exitLabel,
  children,
}: {
  /** Prominent primary label (e.g. the real lesson title). When set, `context` renders as a smaller secondary line. */
  title?: string;
  context?: string;
  progress?: { value: number; max: number };
  progressLabel?: string;
  /** Opt-in compact numeric progress (e.g. "3 / 8"). Callers with a CEILING max (Placement) omit it. */
  progressText?: string;
  onExit?: () => void;
  exitLabel?: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const pct = progress ? clampPercent(progress.value, progress.max) : null;
  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 sm:px-6">
        <BrandMark />
        {title ? (
          <>
            <span aria-hidden className="h-4 w-px bg-border" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold leading-tight text-text">{title}</div>
              {context && <div className="truncate text-[11px] leading-tight text-muted">{context}</div>}
            </div>
          </>
        ) : (
          context && (
            <>
              <span aria-hidden className="h-4 w-px bg-border" />
              <span className="truncate text-sm font-semibold text-muted">{context}</span>
            </>
          )
        )}
        <div className="ml-auto flex items-center gap-2 sm:gap-2.5">
          {progressText && <span className="shrink-0 text-xs font-semibold tabular-nums text-muted">{progressText}</span>}
          <ThemeSwitcher />
          {onExit && (
            <button
              type="button"
              onClick={onExit}
              aria-label={exitLabel ?? t('common.close')}
              className="grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <FiX aria-hidden />
            </button>
          )}
        </div>
      </header>

      {pct !== null && (
        <div className="h-1 w-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={progressLabel ?? t('placement.runner.progressLabel')}>
          <div className="h-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
        </div>
      )}

      <main className="flex flex-1 flex-col items-center overflow-y-auto px-4 py-8 sm:px-6 sm:py-12">
        <div className="w-full max-w-[640px]">{children}</div>
      </main>
    </div>
  );
}
