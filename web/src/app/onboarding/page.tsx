'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FiBook, FiCheck } from 'react-icons/fi';
import { useAuth } from '@/lib/auth/auth-context';
import { useI18n, useT } from '@/lib/i18n/i18n-context';
import { useResource } from '@/lib/hooks/use-resource';
import { fetchProfile, updateProfile } from '@/lib/api/profile';
import { completeOnboarding, fetchLearningIntents, fetchOnboardingStatus, fetchOnboardingSubjects, fetchOnboardingTracks, saveLearningIntent } from '@/lib/api/onboarding';
import type { LearningIntent, LearnerProfile, OnboardingStatus, OnboardingSubject, OnboardingTrack } from '@/lib/api/types';
import { describeError } from '@/lib/ui/error-text';
import { Button, Field, Input, Select, Spinner } from '@/components/ui';
import { ErrorState } from '@/components/ui/states';
import { OnboardingShell } from '@/components/onboarding/OnboardingShell';

type Stage = 'profile' | 'intent';

interface Init {
  profile: LearnerProfile;
  status: OnboardingStatus;
  subjects: OnboardingSubject[];
  intents: LearningIntent[];
}

function guessTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tashkent';
  } catch {
    return 'Asia/Tashkent';
  }
}

/** IANA time zones from the runtime (not hard-coded to Uzbekistan); guarantees the current value is selectable. */
function timezoneOptions(current: string): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  let zones: string[] = [];
  try {
    zones = typeof intl.supportedValuesOf === 'function' ? intl.supportedValuesOf('timeZone') : [];
  } catch {
    zones = [];
  }
  if (zones.length === 0) zones = ['Asia/Tashkent', 'Asia/Samarkand', 'Asia/Almaty', 'Europe/Moscow', 'UTC'];
  return current && !zones.includes(current) ? [current, ...zones] : zones;
}

/** Resume stage from backend state only (never local storage): profile fields gate the profile stage. */
function deriveStage(status: OnboardingStatus): Stage {
  const missing = new Set(status.missing);
  if (missing.has('displayName') || missing.has('dateOfBirth') || missing.has('timezone')) return 'profile';
  return 'intent';
}

export default function OnboardingPage() {
  const t = useT();
  const router = useRouter();
  const load = useCallback(async (): Promise<Init> => {
    const [profile, status, subjects, intents] = await Promise.all([fetchProfile(), fetchOnboardingStatus(), fetchOnboardingSubjects(), fetchLearningIntents()]);
    return { profile, status, subjects, intents };
  }, []);
  const init = useResource(load, []);

  if (!init.data) {
    return (
      <OnboardingShell step={0}>
        <div className="grid min-h-[40vh] w-full max-w-[460px] place-items-center">
          {init.error ? <ErrorState error={init.error} onRetry={init.reload} /> : <Spinner label={t('learner.common.loading')} />}
        </div>
      </OnboardingShell>
    );
  }

  return <Wizard init={init.data} router={router} />;
}

function Wizard({ init, router }: { init: Init; router: ReturnType<typeof useRouter> }) {
  const t = useT();
  const { locale } = useI18n();
  const { user, setAuthenticatedUser } = useAuth();

  // A completed learner should never sit on /onboarding (backend is the authority).
  useEffect(() => {
    if (init.status.completed) router.replace('/learn');
  }, [init.status.completed, router]);

  const existingIntent = useMemo(() => init.intents.find((i) => i.track) ?? init.intents[0] ?? null, [init.intents]);

  const [stage, setStage] = useState<Stage>(() => deriveStage(init.status));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Profile
  const [name, setName] = useState(init.profile.displayName ?? '');
  const [dob, setDob] = useState(init.profile.dateOfBirth ?? '');
  const [tz, setTz] = useState(init.profile.timezone ?? guessTimezone());
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; dob?: string; tz?: string }>({});
  const zones = useMemo(() => timezoneOptions(init.profile.timezone ?? guessTimezone()), [init.profile.timezone]);

  // Selection. subjectId/trackId are the single source of truth; a selected track ALWAYS belongs to subjectId
  // because changing the subject clears the track (invariant preserved from the Phase 3.0 fix).
  const [subjectId, setSubjectId] = useState<string | null>(existingIntent?.subject.id ?? null);
  const [trackId, setTrackId] = useState<string | null>(existingIntent?.track?.id ?? null);

  // Move focus to the step heading after a stage transition (not on first mount).
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    headingRef.current?.focus();
  }, [stage]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const errs: typeof fieldErrors = {};
    if (!name.trim()) errs.name = t('learner.onboarding.nameRequired');
    if (!dob) errs.dob = t('learner.onboarding.dobRequired');
    if (!tz) errs.tz = t('learner.onboarding.timezoneRequired');
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      await updateProfile({ displayName: name.trim(), dateOfBirth: dob, timezone: tz, preferredLanguage: locale });
      setStage('intent');
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function pickSubject(subject: OnboardingSubject) {
    if (busy || subject.id === subjectId) return;
    setBusy(true);
    setError(null);
    try {
      await saveLearningIntent(subject.id); // subject-only, resumable
      setSubjectId(subject.id);
      setTrackId(null); // a track from a previous subject must never leak across subjects
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function pickTrack(track: OnboardingTrack) {
    if (busy || !subjectId) return;
    setBusy(true);
    setError(null);
    try {
      await saveLearningIntent(subjectId, track.id); // complete intent = the ACTUAL current selection
      setTrackId(track.id);
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (busy || !subjectId || !trackId) return;
    setBusy(true);
    setError(null);
    try {
      const status = await fetchOnboardingStatus(); // backend authority — never fake readiness
      if (!status.canComplete) {
        setError(t('learner.onboarding.notReady'));
        return;
      }
      await completeOnboarding();
      if (user) setAuthenticatedUser({ ...user, onboardingCompleted: true });
      // Phase 02B: route into Placement (intro) here instead of the dashboard.
      router.replace('/learn');
    } catch (err) {
      setError(describeError(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <OnboardingShell step={stage === 'profile' ? 0 : 1}>
      <div className={`w-full ${stage === 'profile' ? 'max-w-[460px]' : 'max-w-[960px]'}`}>
        {error && (
          <p role="alert" className="mb-6 rounded-control bg-danger-tint px-3.5 py-2.5 text-sm font-medium text-danger">
            {error}
          </p>
        )}

        {stage === 'profile' ? (
          <ProfileStage
            headingRef={headingRef}
            name={name}
            dob={dob}
            tz={tz}
            zones={zones}
            fieldErrors={fieldErrors}
            busy={busy}
            onName={(v) => {
              setName(v);
              if (fieldErrors.name) setFieldErrors((f) => ({ ...f, name: undefined }));
            }}
            onDob={(v) => {
              setDob(v);
              if (fieldErrors.dob) setFieldErrors((f) => ({ ...f, dob: undefined }));
            }}
            onTz={(v) => {
              setTz(v);
              if (fieldErrors.tz) setFieldErrors((f) => ({ ...f, tz: undefined }));
            }}
            onSubmit={saveProfile}
          />
        ) : (
          <IntentStage
            headingRef={headingRef}
            subjects={init.subjects}
            subjectId={subjectId}
            trackId={trackId}
            busy={busy}
            onBack={() => {
              setError(null);
              setStage('profile');
            }}
            onPickSubject={pickSubject}
            onPickTrack={pickTrack}
            onContinue={finish}
          />
        )}
      </div>
    </OnboardingShell>
  );
}

function ProfileStage({
  headingRef,
  name,
  dob,
  tz,
  zones,
  fieldErrors,
  busy,
  onName,
  onDob,
  onTz,
  onSubmit,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  name: string;
  dob: string;
  tz: string;
  zones: string[];
  fieldErrors: { name?: string; dob?: string; tz?: string };
  busy: boolean;
  onName: (v: string) => void;
  onDob: (v: string) => void;
  onTz: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <span className="text-xs font-bold uppercase tracking-[0.06em] text-primary">{t('learner.onboarding.profileEyebrow')}</span>
        <h1 ref={headingRef} tabIndex={-1} className="text-[28px] font-extrabold leading-tight tracking-tight text-text outline-none">
          {t('learner.onboarding.profileTitle')}
        </h1>
        <p className="text-[15px] leading-relaxed text-muted">{t('learner.onboarding.profileSubtitle')}</p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <Field label={t('learner.onboarding.displayName')} htmlFor="name" error={fieldErrors.name}>
          <Input
            id="name"
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder={t('learner.onboarding.displayNamePlaceholder')}
            autoComplete="name"
            aria-invalid={fieldErrors.name ? true : undefined}
            required
          />
        </Field>

        <Field label={t('learner.onboarding.dob')} htmlFor="dob" hint={t('learner.onboarding.dobHint')} error={fieldErrors.dob}>
          <Input id="dob" type="date" value={dob} onChange={(e) => onDob(e.target.value)} aria-invalid={fieldErrors.dob ? true : undefined} required />
        </Field>

        <Field label={t('learner.onboarding.timezone')} htmlFor="tz" hint={t('learner.onboarding.timezoneHint')} error={fieldErrors.tz}>
          <Select id="tz" value={tz} onChange={(e) => onTz(e.target.value)} aria-invalid={fieldErrors.tz ? true : undefined}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </Field>

        <Button type="submit" size="xl" loading={busy} disabled={busy} className="mt-1 w-full">
          {t('learner.onboarding.continue')}
        </Button>
      </form>
    </div>
  );
}

function IntentStage({
  headingRef,
  subjects,
  subjectId,
  trackId,
  busy,
  onBack,
  onPickSubject,
  onPickTrack,
  onContinue,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  subjects: OnboardingSubject[];
  subjectId: string | null;
  trackId: string | null;
  busy: boolean;
  onBack: () => void;
  onPickSubject: (s: OnboardingSubject) => void;
  onPickTrack: (tr: OnboardingTrack) => void;
  onContinue: () => void;
}) {
  const t = useT();
  const selectedSubject = subjects.find((s) => s.id === subjectId) ?? null;

  return (
    <div className="flex flex-col gap-9">
      <div className="flex flex-col gap-3">
        <h1 ref={headingRef} tabIndex={-1} className="text-[28px] font-extrabold leading-tight tracking-tight text-text outline-none">
          {t('learner.onboarding.intentTitle')}
        </h1>
        <p className="text-[15px] leading-relaxed text-muted">{t('learner.onboarding.intentSubtitle')}</p>
      </div>

      {/* Subject */}
      <section className="flex flex-col gap-4">
        <h2 className="text-[13px] font-bold text-text">{t('learner.onboarding.subjectSection')}</h2>
        {subjects.length === 0 ? (
          <EmptyPanel title={t('learner.onboarding.subjectEmpty')} hint={t('learner.onboarding.subjectEmptyHint')} />
        ) : (
          <div role="radiogroup" aria-label={t('learner.onboarding.subjectSection')} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {subjects.map((s) => {
              const selected = subjectId === s.id;
              return (
                <label
                  key={s.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-panel border p-4 transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary ${
                    selected ? 'border-primary bg-primary-tint' : 'border-border bg-surface hover:border-primary/40'
                  } ${busy ? 'pointer-events-none opacity-70' : ''}`}
                >
                  <input
                    type="radio"
                    name="subject"
                    className="peer sr-only"
                    checked={selected}
                    onChange={() => onPickSubject(s)}
                    disabled={busy}
                    aria-label={s.title}
                  />
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[9px] text-primary ${selected ? 'bg-surface' : 'bg-primary-tint'}`}>
                    <FiBook aria-hidden size={18} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-bold text-text">{s.title}</span>
                    {s.description && <span className="truncate text-xs text-muted">{s.description}</span>}
                  </span>
                  {selected && <FiCheck aria-hidden className="shrink-0 text-primary" size={18} />}
                </label>
              );
            })}
          </div>
        )}
      </section>

      {/* Track — same frame, appears once a subject is chosen */}
      {subjectId && selectedSubject && (
        <TrackSection subjectId={subjectId} subjectTitle={selectedSubject.title} trackId={trackId} busy={busy} onPickTrack={onPickTrack} />
      )}

      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="md" onClick={onBack} disabled={busy}>
          {t('learner.onboarding.back')}
        </Button>
        <Button size="xl" onClick={onContinue} loading={busy} disabled={busy || !subjectId || !trackId} className="min-w-[200px]">
          {t('learner.onboarding.continue')}
        </Button>
      </div>
    </div>
  );
}

function TrackSection({
  subjectId,
  subjectTitle,
  trackId,
  busy,
  onPickTrack,
}: {
  subjectId: string;
  subjectTitle: string;
  trackId: string | null;
  busy: boolean;
  onPickTrack: (tr: OnboardingTrack) => void;
}) {
  const t = useT();
  const load = useCallback(() => fetchOnboardingTracks(subjectId), [subjectId]);
  const tracks = useResource(load, [subjectId]);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[13px] font-bold text-text">{t('learner.onboarding.trackSectionFor', { subject: subjectTitle })}</h2>
      {tracks.loading && (
        <div className="flex items-center gap-2 rounded-panel border border-border bg-surface px-4 py-6 text-sm text-muted">
          <Spinner label={t('learner.common.loading')} />
        </div>
      )}
      {tracks.error ? <ErrorState error={tracks.error} onRetry={tracks.reload} /> : null}
      {tracks.data && tracks.data.length === 0 && <EmptyPanel title={t('learner.onboarding.trackEmpty')} />}
      {tracks.data && tracks.data.length > 0 && (
        <div role="radiogroup" aria-label={t('learner.onboarding.trackChoose')} className="flex flex-col gap-3">
          {tracks.data.map((tr) => {
            const selected = trackId === tr.id;
            return (
              <label
                key={tr.id}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-panel border p-4 transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary ${
                  selected ? 'border-primary bg-primary-tint' : 'border-border bg-surface hover:border-primary/40'
                } ${busy ? 'pointer-events-none opacity-70' : ''}`}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-bold text-text">{tr.title}</span>
                  {tr.description && <span className="text-xs text-muted">{tr.description}</span>}
                </span>
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="track"
                    className="peer sr-only"
                    checked={selected}
                    onChange={() => onPickTrack(tr)}
                    disabled={busy}
                    aria-label={tr.title}
                  />
                  {selected ? (
                    <FiCheck aria-hidden className="text-primary" size={18} />
                  ) : (
                    <span aria-hidden className="h-[18px] w-[18px] rounded-full border-[1.5px] border-border" />
                  )}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </section>
  );
}

function EmptyPanel({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-panel border border-dashed border-border bg-surface-2 px-4 py-10 text-center">
      <p className="text-sm font-semibold text-text">{title}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
