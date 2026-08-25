'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FiCheck } from 'react-icons/fi';
import { useT } from '@/lib/i18n/i18n-context';
import { useResource } from '@/lib/hooks/use-resource';
import { describeError } from '@/lib/ui/error-text';
import { isApiError } from '@/lib/api/errors';
import { checkPlacementAvailability, getAttempt, startPlacement, submitResponse } from '@/lib/api/assessment';
import { deriveDiagnostic, getDiagnosticSnapshot } from '@/lib/api/skill-profile';
import { generateInitialRoadmap } from '@/lib/api/roadmap';
import { fetchLearningIntents } from '@/lib/api/onboarding';
import type { AttemptView, DiagnosticSnapshot, LearningIntent, PlacementAnswer } from '@/lib/api/types';
import { Button, ButtonLink, MasteryProgress, Spinner } from '@/components/ui';
import { OnboardingShell } from '@/components/onboarding/OnboardingShell';
import { FocusLearningShell } from '@/components/learning/FocusLearningShell';
import { QuestionCard } from '@/components/learning/QuestionCard';

export default function PlacementPage() {
  return (
    <Suspense fallback={null}>
      <PlacementFlow />
    </Suspense>
  );
}

/** Backend is the single authority: this only reflects the AttemptView it returns; it never scores or advances. */
function PlacementFlow() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const learningIntentId = params.get('learningIntentId');
  const attemptParam = params.get('attempt');

  // Subject/track context (best-effort, for display only — never an authority). Loaded once when we know the intent.
  const intentsRes = useResource<LearningIntent[]>(
    useCallback(() => (learningIntentId ? fetchLearningIntents() : Promise.resolve([])), [learningIntentId]),
    [learningIntentId],
  );
  const intent = useMemo(() => intentsRes.data?.find((i) => i.id === learningIntentId) ?? null, [intentsRes.data, learningIntentId]);
  const subjectTitle = intent?.subject.title ?? null;

  // The single attempt authority, held from start() or a reload GET (?attempt). GET is a pure read — never advances.
  const [attempt, setAttempt] = useState<AttemptView | null>(null);
  const [attemptError, setAttemptError] = useState<unknown>(null);
  const [attemptLoading, setAttemptLoading] = useState(false);

  useEffect(() => {
    if (!attemptParam) return;
    if (attempt?.attemptId === attemptParam) return; // already have it (e.g. just started) — no redundant GET
    let active = true;
    setAttemptLoading(true);
    setAttemptError(null);
    getAttempt(attemptParam)
      .then((v) => active && (setAttempt(v), setAttemptLoading(false)))
      .catch((e) => active && (setAttemptError(e), setAttemptLoading(false)));
    return () => {
      active = false;
    };
  }, [attemptParam, attempt?.attemptId]);

  function goToAttempt(view: AttemptView) {
    setAttempt(view);
    const q = new URLSearchParams();
    if (learningIntentId) q.set('learningIntentId', learningIntentId);
    q.set('attempt', view.attemptId);
    router.replace(`/placement?${q.toString()}`);
  }

  // ── Attempt path (Runner / Result), including reload resume ──
  if (attemptParam) {
    if (attemptError) {
      return (
        <OnboardingShell step={2}>
          <NoticePanel title={t('errors.notFound')} body={describeError(attemptError, t)} cta={{ href: '/learn', label: t('placement.result.continue') }} />
        </OnboardingShell>
      );
    }
    if (!attempt || attemptLoading) return <FocusLoading label={t('placement.result.loading')} />;
    if (attempt.status === 'COMPLETED') return <ResultView attempt={attempt} subjectTitle={subjectTitle} />;
    return <RunnerView attempt={attempt} setAttempt={setAttempt} subjectTitle={subjectTitle} onExit={() => router.replace('/learn')} />;
  }

  // ── Intro path (no attempt yet) ──
  if (!learningIntentId) {
    return (
      <OnboardingShell step={2}>
        <NoticePanel title={t('placement.intro.noIntentTitle')} body={t('placement.intro.noIntentBody')} cta={{ href: '/onboarding', label: t('placement.intro.backToOnboarding') }} />
      </OnboardingShell>
    );
  }
  return <IntroView learningIntentId={learningIntentId} intent={intent} onStarted={goToAttempt} />;
}

// ───────────────────────── Intro ─────────────────────────

function IntroView({ learningIntentId, intent, onStarted }: { learningIntentId: string; intent: LearningIntent | null; onStarted: (v: AttemptView) => void }) {
  const t = useT();
  const availability = useResource(useCallback(() => checkPlacementAvailability(learningIntentId), [learningIntentId]), [learningIntentId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const view = await startPlacement(learningIntentId);
      onStarted(view);
    } catch (e) {
      setError(describeError(e, t));
      setBusy(false);
    }
  }

  return (
    <OnboardingShell step={2}>
      {availability.loading && (
        <div className="grid min-h-[40vh] place-items-center">
          <Spinner label={t('learner.common.loading')} />
        </div>
      )}
      {availability.error != null && (
        <NoticePanel title={t('placement.intro.unavailableTitle')} body={describeError(availability.error, t)} cta={{ href: '/learn', label: t('placement.intro.backToLearn') }} onRetry={availability.reload} retryLabel={t('common.reload')} />
      )}
      {availability.data && !availability.data.available && (
        <NoticePanel title={t('placement.intro.unavailableTitle')} body={t('placement.intro.unavailableBody')} cta={{ href: '/learn', label: t('placement.intro.backToLearn') }} />
      )}
      {availability.data?.available && (
        <div className="flex flex-col gap-7">
          {intent && (
            <div className="inline-flex w-fit items-center gap-2.5 rounded-full border border-border bg-surface-2 px-3.5 py-2 text-[13px]">
              <span className="font-bold">{intent.subject.title}</span>
              {intent.track && (
                <>
                  <span aria-hidden className="h-3 w-px bg-border" />
                  <span className="text-muted">{intent.track.title}</span>
                </>
              )}
            </div>
          )}
          <div className="flex flex-col gap-3">
            <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-text">{t('placement.intro.title')}</h1>
            <p className="text-[15px] leading-relaxed text-muted">{t('placement.intro.subtitle')}</p>
          </div>
          <ul className="flex flex-col gap-3.5">
            {[t('placement.intro.b1'), t('placement.intro.b2'), t('placement.intro.b3')].map((b) => (
              <li key={b} className="flex items-start gap-3">
                <FiCheck aria-hidden className="mt-0.5 shrink-0 text-primary" size={18} />
                <span className="text-[14.5px] leading-relaxed text-text">{b}</span>
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-muted">{t('placement.intro.duration')}</p>
          {error && (
            <p role="alert" className="rounded-control bg-danger-tint px-3.5 py-2.5 text-sm font-medium text-danger">
              {error}
            </p>
          )}
          <div className="flex flex-col gap-3 pt-1">
            <Button type="button" size="xl" loading={busy} disabled={busy} className="w-full" onClick={start}>
              {t('placement.intro.start')}
            </Button>
            <ButtonLink href="/learn" variant="ghost" size="md" className="justify-center">
              {t('placement.intro.later')}
            </ButtonLink>
          </div>
        </div>
      )}
    </OnboardingShell>
  );
}

// ───────────────────────── Runner ─────────────────────────

function RunnerView({ attempt, setAttempt, subjectTitle, onExit }: { attempt: AttemptView; setAttempt: (v: AttemptView) => void; subjectTitle: string | null; onExit: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  // Reset on SETUP, not just cleanup: under React StrictMode (next.config: reactStrictMode) the mount effect runs
  // mount→cleanup→mount, which would otherwise latch `mounted.current` to false for the component's whole life — then
  // every `if (!mounted.current) return;` after an awaited submit bails BEFORE setAttempt(next), so the runner never
  // advances even though the server already progressed (the exact "answer → UI frozen, must re-enter" QA bug).
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const item = attempt.item;
  const context = subjectTitle ? t('placement.runner.context', { subject: subjectTitle }) : t('placement.result.title');

  async function onSubmit(answer: PlacementAnswer) {
    if (busy || !item) return;
    setBusy(true);
    setError(null);
    try {
      const next = await submitResponse(attempt.attemptId, item.id, answer);
      if (!mounted.current) return;
      setBusy(false);
      setAttempt(next); // authority — may switch this view to Result if COMPLETED
    } catch (e) {
      if (!mounted.current) return;
      // Recoverable conflicts (already answered differently / no longer current / already completed) → resync from server.
      if (isApiError(e) && (e.code === 'ASSESSMENT_RESPONSE_CONFLICT' || e.code === 'ASSESSMENT_ITEM_NOT_CURRENT' || e.code === 'ASSESSMENT_ALREADY_COMPLETED')) {
        try {
          const fresh = await getAttempt(attempt.attemptId);
          if (!mounted.current) return;
          setAttempt(fresh);
          setError(t('placement.runner.conflict'));
        } catch (e2) {
          if (mounted.current) setError(describeError(e2, t));
        }
      } else {
        setError(describeError(e, t)); // NetworkError → network; abort → '' (no banner); ApiError → localized
      }
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <FocusLearningShell context={context} progress={{ value: attempt.progress.answered, max: attempt.progress.maxItems }} onExit={onExit} exitLabel={t('placement.exit')}>
      {item ? (
        <div className="flex flex-col gap-5">
          {error && (
            <p role="alert" className="rounded-control bg-danger-tint px-3.5 py-2.5 text-sm font-medium text-danger">
              {error}
            </p>
          )}
          <QuestionCard
            item={item}
            onSubmit={onSubmit}
            submitting={busy}
            submitLabel={t('placement.runner.submit')}
            questionLabel={t('placement.runner.questionLabel', { n: attempt.progress.answered + 1 })}
          />
        </div>
      ) : (
        <div className="grid min-h-[40vh] place-items-center">
          <Spinner label={t('learner.common.loading')} />
        </div>
      )}
    </FocusLearningShell>
  );
}

// ───────────────────────── Result ─────────────────────────

function ResultView({ attempt, subjectTitle }: { attempt: AttemptView; subjectTitle: string | null }) {
  const t = useT();
  const attemptId = attempt.attemptId;
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot | null>(null);
  const [snapError, setSnapError] = useState<unknown>(null);
  const [snapLoading, setSnapLoading] = useState(true);
  const derivedOnce = useRef(false);

  // Resilient load: GET the derived snapshot; if the backend says it isn't derived yet, POST derive ONCE, then use it.
  useEffect(() => {
    let active = true;
    setSnapLoading(true);
    setSnapError(null);
    getDiagnosticSnapshot(attemptId)
      .then((s) => active && (setSnapshot(s), setSnapLoading(false)))
      .catch(async (e) => {
        if (!active) return;
        if (isApiError(e) && e.code === 'SKILL_PROFILE_NOT_DERIVED' && !derivedOnce.current) {
          derivedOnce.current = true;
          try {
            const s = await deriveDiagnostic(attemptId);
            if (active) {
              setSnapshot(s);
              setSnapLoading(false);
            }
          } catch (e2) {
            if (active) {
              setSnapError(e2);
              setSnapLoading(false);
            }
          }
        } else {
          setSnapError(e);
          setSnapLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [attemptId]);

  const skills = snapshot?.skills ?? [];
  const sorted = useMemo(() => [...skills].sort((a, b) => b.masteryScoreBp - a.masteryScoreBp), [skills]);
  const strongest = sorted[0] ?? null;
  const weakest = sorted.length > 1 ? sorted[sorted.length - 1] : null;
  const nameById = useMemo(() => new Map(skills.map((s) => [s.skillId, s.name])), [skills]);
  const insufficientNames = (attempt.result?.insufficientSkillIds ?? []).map((id) => nameById.get(id)).filter((n): n is string => !!n);
  const hasInsufficient = (attempt.result?.insufficientSkillIds?.length ?? 0) > 0;

  return (
    <OnboardingShell step={2}>
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-text">{t('placement.result.title')}</h1>
          <p className="text-[15px] leading-relaxed text-muted">{t('placement.result.subtitle')}</p>
        </div>

        {snapLoading && (
          <div className="grid min-h-[30vh] place-items-center">
            <Spinner label={t('placement.result.loading')} />
          </div>
        )}

        {snapError != null && !snapshot && (
          <p role="alert" className="rounded-control bg-danger-tint px-3.5 py-2.5 text-sm font-medium text-danger">
            {describeError(snapError, t)}
          </p>
        )}

        {snapshot && (
          <>
            {/* Starting-point card. displayLevel is null in v1 → we DO NOT fabricate a CEFR/level label. */}
            <div className="flex items-center gap-4 rounded-panel border border-border bg-surface p-5">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-panel bg-primary-tint text-primary">
                <FiCheck aria-hidden size={26} />
              </span>
              <div className="flex flex-col gap-0.5">
                {subjectTitle && <span className="text-xs font-semibold uppercase tracking-wide text-muted">{t('placement.result.levelEyebrow', { subject: subjectTitle })}</span>}
                <span className="text-[17px] font-bold text-text">{t('placement.result.title')}</span>
              </div>
            </div>

            {skills.length > 0 && (
              <section className="flex flex-col gap-4">
                <h2 className="text-[13px] font-bold text-text">{t('placement.result.skillsTitle')}</h2>
                <div className="flex flex-col gap-4">
                  {skills.map((s) => (
                    <div key={s.skillId} className="flex flex-col gap-1.5">
                      <MasteryProgress value={s.masteryScoreBp / 100} label={s.name} className="" />
                      {s.confidenceBp !== null && (
                        <span className="text-xs text-muted">
                          {t('placement.result.confidence')}: {Math.round(s.confidenceBp / 100)}%
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {strongest && weakest && strongest.skillId !== weakest.skillId && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1 rounded-panel bg-success-tint p-4">
                  <span className="text-xs font-bold uppercase tracking-wide text-success">{t('placement.result.strength')}</span>
                  <span className="text-[14.5px] font-semibold text-text">{strongest.name}</span>
                </div>
                <div className="flex flex-col gap-1 rounded-panel bg-surface-2 p-4">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted">{t('placement.result.focus')}</span>
                  <span className="text-[14.5px] font-semibold text-text">{weakest.name}</span>
                </div>
              </div>
            )}

            {hasInsufficient && (
              <p className="rounded-panel border border-dashed border-border bg-surface-2 px-4 py-3 text-[13px] text-muted">
                {t('placement.result.insufficient')}
                {insufficientNames.length > 0 && <span className="text-text"> {insufficientNames.join(', ')}</span>}
              </p>
            )}

            <StartLearningCta attemptId={attemptId} />
          </>
        )}
      </div>
    </OnboardingShell>
  );
}

function StartLearningCta({ attemptId }: { attemptId: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await generateInitialRoadmap(attemptId); // idempotent; server-authored
      router.replace('/learn'); // Phase 03 redesigns Home & Roadmap; today's /learn is expected to look old
    } catch (e) {
      setError(describeError(e, t));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 pt-1">
      {error && (
        <p role="alert" className="rounded-control bg-danger-tint px-3.5 py-2.5 text-sm font-medium text-danger">
          {error}
        </p>
      )}
      <Button type="button" size="xl" loading={busy} disabled={busy} className="w-full" onClick={start}>
        {busy ? t('placement.result.generating') : t('placement.result.start')}
      </Button>
      {error && (
        <ButtonLink href="/learn" variant="ghost" size="md" className="justify-center">
          {t('placement.result.continue')}
        </ButtonLink>
      )}
    </div>
  );
}

// ───────────────────────── shared bits ─────────────────────────

function FocusLoading({ label }: { label: string }) {
  return (
    <FocusLearningShell>
      <div className="grid min-h-[40vh] place-items-center">
        <Spinner label={label} />
      </div>
    </FocusLearningShell>
  );
}

function NoticePanel({ title, body, cta, onRetry, retryLabel }: { title: string; body: string; cta: { href: string; label: string }; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div className="mx-auto flex max-w-[460px] flex-col items-center gap-4 rounded-panel border border-border bg-surface px-6 py-12 text-center">
      <h1 className="text-[22px] font-extrabold tracking-tight text-text">{title}</h1>
      <p className="text-sm leading-relaxed text-muted">{body}</p>
      <div className="mt-2 flex flex-col items-center gap-2">
        {onRetry && (
          <Button type="button" variant="secondary" size="md" onClick={onRetry}>
            {retryLabel}
          </Button>
        )}
        <ButtonLink href={cta.href} variant={onRetry ? 'ghost' : 'primary'} size="md">
          {cta.label}
        </ButtonLink>
      </div>
    </div>
  );
}
