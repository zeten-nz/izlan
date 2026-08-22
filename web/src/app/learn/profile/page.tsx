'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FiLogOut } from 'react-icons/fi';
import { useAuth } from '@/lib/auth/auth-context';
import { LOCALES, useI18n, type Locale } from '@/lib/i18n/i18n-context';
import { useT } from '@/lib/i18n/i18n-context';
import { useResource } from '@/lib/hooks/use-resource';
import { fetchProfile, updateProfile } from '@/lib/api/profile';
import type { LearnerProfile } from '@/lib/api/types';
import { describeError } from '@/lib/ui/error-text';
import { Button, Card, Field, Input, Select, useToast } from '@/components/ui';
import { ResourceView } from '@/components/ui/states';

export default function ProfilePage() {
  const t = useT();
  const res = useResource(useCallback(fetchProfile, []), []);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('learner.profile.title')}</h1>
        <p className="mt-1 text-muted">{t('learner.profile.subtitle')}</p>
      </div>
      <ResourceView loading={res.loading} error={res.error} data={res.data} onRetry={res.reload}>
        {(p) => <ProfileForm profile={p} />}
      </ResourceView>
    </div>
  );
}

function ProfileForm({ profile }: { profile: LearnerProfile }) {
  const t = useT();
  const router = useRouter();
  const { toast } = useToast();
  const { locale, setLocale } = useI18n();
  const { logout } = useAuth();

  const [name, setName] = useState(profile.displayName ?? '');
  const [dob, setDob] = useState(profile.dateOfBirth ?? '');
  const [tz, setTz] = useState(profile.timezone ?? '');
  const [lang, setLang] = useState<Locale>((profile.preferredLanguage as Locale) ?? locale);
  const [busy, setBusy] = useState(false);
  const dobLocked = profile.onboarding.completed;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await updateProfile({
        displayName: name.trim(),
        timezone: tz.trim(),
        preferredLanguage: lang,
        ...(dobLocked ? {} : { dateOfBirth: dob }), // never send a DOB change the backend will reject after onboarding
      });
      setLocale(lang); // reflect the saved language in the chrome immediately (§38)
      toast(t('learner.profile.saved'), 'success');
    } catch (err) {
      toast(describeError(err, t), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <Card className="p-6">
      <form onSubmit={save} className="space-y-4">
        <Field label={t('learner.profile.displayName')} htmlFor="name">
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label={t('learner.profile.dob')} htmlFor="dob" hint={dobLocked ? t('learner.profile.dobLocked') : undefined}>
          <Input id="dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} disabled={dobLocked} />
        </Field>
        <Field label={t('learner.profile.timezone')} htmlFor="tz">
          <Input id="tz" value={tz} onChange={(e) => setTz(e.target.value)} />
        </Field>
        <Field label={t('learner.profile.language')} htmlFor="lang" hint={t('learner.profile.uiLanguageNote')}>
          <Select id="lang" value={lang} onChange={(e) => setLang(e.target.value as Locale)}>
            {LOCALES.map((l) => <option key={l} value={l}>{t(`locale.${l}`)}</option>)}
          </Select>
        </Field>
        <div className="flex items-center justify-between pt-2">
          <Button type="button" variant="ghost" leftIcon={<FiLogOut aria-hidden />} onClick={onLogout}>
            {t('learner.profile.logout')}
          </Button>
          <Button type="submit" loading={busy} disabled={busy}>{t('learner.profile.save')}</Button>
        </div>
      </form>
    </Card>
  );
}
