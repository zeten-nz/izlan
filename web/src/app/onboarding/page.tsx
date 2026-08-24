'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FiCheck } from 'react-icons/fi';
import { useAuth } from '@/lib/auth/auth-context';
import { useT } from '@/lib/i18n/i18n-context';
import { LOCALES, useI18n, type Locale } from '@/lib/i18n/i18n-context';
import { useResource } from '@/lib/hooks/use-resource';
import { fetchProfile, updateProfile } from '@/lib/api/profile';
import { completeOnboarding, fetchLearningIntents, fetchOnboardingStatus, fetchOnboardingSubjects, fetchOnboardingTracks, saveLearningIntent } from '@/lib/api/onboarding';
import type { LearningIntent, LearnerProfile, OnboardingStatus, OnboardingSubject } from '@/lib/api/types';
import { describeError } from '@/lib/ui/error-text';
import { Button, Card, Field, Input, Select } from '@/components/ui';
import { ResourceView } from '@/components/ui/states';

type StepKey = 'profile' | 'subject' | 'track' | 'review';
const STEP_ORDER: StepKey[] = ['profile', 'subject', 'track', 'review'];

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

/** Derive the resume step purely from backend state (§32) — never from local storage. */
function deriveStep(d: Init): StepKey {
  const missing = new Set(d.status.missing);
  if (missing.has('displayName') || missing.has('dateOfBirth') || missing.has('timezone')) return 'profile';
  const intent = d.intents.find((i) => i.track) ?? d.intents[0];
  if (!intent) return 'subject';
  if (!intent.track) return 'track';
  return 'review';
}

function Steps({ active }: { active: number }) {
  const t = useT();
  const labels = [t('learner.onboarding.stepProfile'), t('learner.onboarding.stepSubject'), t('learner.onboarding.stepTrack'), t('learner.onboarding.stepStart')];
  return (
    <ol className="mb-6 flex items-center gap-2" aria-label="progress">
      {labels.map((label, i) => (
        <li key={label} className="flex flex-1 items-center gap-2">
          <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${i < active ? 'bg-primary text-primary-fg' : i === active ? 'border-2 border-primary text-primary' : 'border border-border text-muted'}`}>
            {i < active ? <FiCheck aria-hidden /> : i + 1}
          </span>
          <span className={`hidden truncate text-xs sm:block ${i === active ? 'font-medium text-text' : 'text-muted'}`}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

export default function OnboardingPage() {
  const t = useT();
  const router = useRouter();
  const init = useResource(useCallback(async (): Promise<Init> => {
    const [profile, status, subjects, intents] = await Promise.all([fetchProfile(), fetchOnboardingStatus(), fetchOnboardingSubjects(), fetchLearningIntents()]);
    return { profile, status, subjects, intents };
  }, []), []);

  return (
    <ResourceView loading={init.loading} error={init.error} data={init.data} onRetry={init.reload}>
      {(d) => <Wizard init={d} onReload={init.reload} router={router} />}
    </ResourceView>
  );
}

function Wizard({ init, onReload, router }: { init: Init; onReload: () => void; router: ReturnType<typeof useRouter> }) {
  const t = useT();
  const { locale, setLocale } = useI18n();
  const { user, setAuthenticatedUser } = useAuth();

  // Completed learner should not stay on /onboarding (§15/§32).
  useEffect(() => {
    if (init.status.completed) router.replace('/learn');
  }, [init.status.completed, router]);

  const existingIntent = useMemo(() => init.intents.find((i) => i.track) ?? init.intents[0] ?? null, [init.intents]);
  const [step, setStep] = useState<StepKey>(() => deriveStep(init));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Profile form
  const [name, setName] = useState(init.profile.displayName ?? '');
  const [dob, setDob] = useState(init.profile.dateOfBirth ?? '');
  const [tz, setTz] = useState(init.profile.timezone ?? guessTimezone());

  // Selection
  const [subjectId, setSubjectId] = useState<string | null>(existingIntent?.subject.id ?? null);
  const [trackId, setTrackId] = useState<string | null>(existingIntent?.track?.id ?? null);
  const selectedSubject = init.subjects.find((s) => s.id === subjectId) ?? existingIntent?.subject ?? null;

  const stepIndex = STEP_ORDER.indexOf(step);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await updateProfile({ displayName: name.trim(), dateOfBirth: dob, timezone: tz.trim(), preferredLanguage: locale });
      setStep('subject');
    } catch (err) { setError(describeError(err, t)); } finally { setBusy(false); }
  }

  async function pickSubject(id: string) {
    setBusy(true); setError(null);
    try {
      await saveLearningIntent(id); // subject-only resumable state
      setSubjectId(id); setTrackId(null);
      setStep('track');
    } catch (err) { setError(describeError(err, t)); } finally { setBusy(false); }
  }

  async function pickTrack(id: string) {
    if (!subjectId) return;
    setBusy(true); setError(null);
    try {
      await saveLearningIntent(subjectId, id); // complete intent
      setTrackId(id);
      setStep('review');
    } catch (err) { setError(describeError(err, t)); } finally { setBusy(false); }
  }

  async function finish() {
    setBusy(true); setError(null);
    try {
      const status = await fetchOnboardingStatus(); // authority: only complete when canComplete
      if (!status.canComplete) { onReload(); setError(describeError({ code: 'PROFILE_INCOMPLETE', status: 409 } as unknown, t)); setBusy(false); return; }
      await completeOnboarding();
      if (user) setAuthenticatedUser({ ...user, onboardingCompleted: true });
      router.replace('/learn');
    } catch (err) { setError(describeError(err, t)); setBusy(false); }
  }

  return (
    <Card className="p-6 sm:p-8">
      <Steps active={stepIndex} />
      {error && <p role="alert" className="mb-4 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}

      {step === 'profile' && (
        <form onSubmit={saveProfile} className="space-y-4" noValidate>
          <div>
            <h1 className="text-xl font-bold tracking-tight">{t('learner.onboarding.profileTitle')}</h1>
            <p className="mt-1 text-sm text-muted">{t('learner.onboarding.profileSubtitle')}</p>
          </div>
          <Field label={t('learner.onboarding.displayName')} htmlFor="name">
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('learner.onboarding.displayNamePlaceholder')} required />
          </Field>
          <Field label={t('learner.onboarding.dob')} htmlFor="dob" hint={t('learner.onboarding.dobHint')}>
            <Input id="dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} required />
          </Field>
          <Field label={t('learner.onboarding.timezone')} htmlFor="tz">
            <Input id="tz" value={tz} onChange={(e) => setTz(e.target.value)} required />
          </Field>
          <Field label={t('learner.onboarding.language')} htmlFor="lang">
            <Select id="lang" value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
              {LOCALES.map((l) => <option key={l} value={l}>{t(`locale.${l}`)}</option>)}
            </Select>
          </Field>
          <Button type="submit" loading={busy} disabled={busy} className="w-full">{t('learner.onboarding.saveContinue')}</Button>
        </form>
      )}

      {step === 'subject' && (
        <div className="space-y-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">{t('learner.onboarding.subjectTitle')}</h1>
            <p className="mt-1 text-sm text-muted">{t('learner.onboarding.subjectSubtitle')}</p>
          </div>
          {init.subjects.length === 0 ? (
            <div className="rounded-card border border-dashed border-border bg-surface-2 px-4 py-10 text-center">
              <p className="font-medium text-text">{t('learner.onboarding.subjectEmpty')}</p>
              <p className="mt-1 text-sm text-muted">{t('learner.onboarding.subjectEmptyHint')}</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {init.subjects.map((s) => (
                <li key={s.id}>
                  <button type="button" disabled={busy} onClick={() => pickSubject(s.id)} className={`flex w-full items-center justify-between rounded-card border px-4 py-3 text-left transition-colors ${subjectId === s.id ? 'border-primary bg-surface-2' : 'border-border bg-surface hover:bg-surface-2'}`}>
                    <span>
                      <span className="block font-medium text-text">{s.title}</span>
                      {s.description && <span className="block text-sm text-muted">{s.description}</span>}
                    </span>
                    <span className="text-sm text-primary">{subjectId === s.id ? t('learner.onboarding.selected') : t('learner.onboarding.select')}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep('profile')} disabled={busy}>{t('learner.onboarding.back')}</Button>
          </div>
        </div>
      )}

      {step === 'track' && <TrackStep subjectId={subjectId} subjectTitle={selectedSubject?.title ?? ''} trackId={trackId} busy={busy} onBack={() => setStep('subject')} onPick={pickTrack} />}

      {step === 'review' && (
        <div className="space-y-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">{t('learner.onboarding.reviewTitle')}</h1>
            <p className="mt-1 text-sm text-muted">{t('learner.onboarding.reviewSubtitle')}</p>
          </div>
          <dl className="divide-y divide-border rounded-card border border-border">
            <Row label={t('learner.onboarding.reviewName')} value={name.trim() || init.profile.displayName || '—'} />
            <Row label={t('learner.onboarding.reviewSubject')} value={selectedSubject?.title ?? existingIntent?.subject.title ?? '—'} />
            <Row label={t('learner.onboarding.reviewTrack')} value={existingIntent?.track?.title ?? '—'} />
          </dl>
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep('track')} disabled={busy}>{t('learner.onboarding.back')}</Button>
            <Button onClick={finish} loading={busy} disabled={busy}>{t('learner.onboarding.start')}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-medium text-text">{value}</dd>
    </div>
  );
}

function TrackStep({ subjectId, subjectTitle, trackId, busy, onBack, onPick }: { subjectId: string | null; subjectTitle: string; trackId: string | null; busy: boolean; onBack: () => void; onPick: (id: string) => void }) {
  const t = useT();
  const tracks = useResource(useCallback(() => (subjectId ? fetchOnboardingTracks(subjectId) : Promise.resolve([])), [subjectId]), [subjectId]);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{t('learner.onboarding.trackTitle')}</h1>
        <p className="mt-1 text-sm text-muted">{t('learner.onboarding.trackSubtitle', { subject: subjectTitle })}</p>
      </div>
      <ResourceView loading={tracks.loading} error={tracks.error} data={tracks.data} onRetry={tracks.reload} isEmpty={(x) => x.length === 0} empty={<div className="rounded-card border border-dashed border-border bg-surface-2 px-4 py-10 text-center text-muted">{t('learner.onboarding.trackEmpty')}</div>}>
        {(list) => (
          <ul className="space-y-2">
            {list.map((tr) => (
              <li key={tr.id}>
                <button type="button" disabled={busy} onClick={() => onPick(tr.id)} className={`flex w-full items-center justify-between rounded-card border px-4 py-3 text-left transition-colors ${trackId === tr.id ? 'border-primary bg-surface-2' : 'border-border bg-surface hover:bg-surface-2'}`}>
                  <span>
                    <span className="block font-medium text-text">{tr.title}</span>
                    {tr.description && <span className="block text-sm text-muted">{tr.description}</span>}
                  </span>
                  <span className="text-sm text-primary">{trackId === tr.id ? t('learner.onboarding.selected') : t('learner.onboarding.select')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </ResourceView>
      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack} disabled={busy}>{t('learner.onboarding.back')}</Button>
      </div>
    </div>
  );
}
