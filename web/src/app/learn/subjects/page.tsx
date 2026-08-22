'use client';

import { useCallback, useState } from 'react';
import { FiPlus } from 'react-icons/fi';
import { useT } from '@/lib/i18n/i18n-context';
import { useResource } from '@/lib/hooks/use-resource';
import { fetchLearningIntents, fetchOnboardingSubjects, fetchOnboardingTracks, saveLearningIntent } from '@/lib/api/onboarding';
import type { LearningIntent, OnboardingSubject } from '@/lib/api/types';
import { describeError } from '@/lib/ui/error-text';
import { Button, Card, useToast } from '@/components/ui';
import { ResourceView } from '@/components/ui/states';
import { Dialog } from '@/components/ui/dialog';

interface SubjectsData {
  intents: LearningIntent[];
  subjects: OnboardingSubject[];
}

async function load(): Promise<SubjectsData> {
  const [intents, subjects] = await Promise.all([fetchLearningIntents(), fetchOnboardingSubjects()]);
  return { intents, subjects };
}

/** Track picker for a subject (uses the same learning-intent authority as onboarding). */
function TrackDialog({ subjectId, subjectTitle, open, onClose, onDone }: { subjectId: string; subjectTitle: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const tracks = useResource(useCallback(() => (open ? fetchOnboardingTracks(subjectId) : Promise.resolve([])), [subjectId, open]), [subjectId, open]);
  const [busy, setBusy] = useState(false);

  async function pick(trackId: string) {
    setBusy(true);
    try {
      await saveLearningIntent(subjectId, trackId);
      toast(t('learner.subjects.saved'), 'success');
      onDone();
      onClose();
    } catch (e) {
      toast(describeError(e, t), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={`${t('learner.subjects.chooseTrack')} · ${subjectTitle}`}>
      <ResourceView loading={tracks.loading} error={tracks.error} data={tracks.data} onRetry={tracks.reload} isEmpty={(x) => x.length === 0} empty={<div className="py-6 text-center text-muted">{t('learner.onboarding.trackEmpty')}</div>}>
        {(list) => (
          <ul className="space-y-2">
            {list.map((tr) => (
              <li key={tr.id}>
                <button type="button" disabled={busy} onClick={() => pick(tr.id)} className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-2">
                  <span className="font-medium text-text">{tr.title}</span>
                  <span className="text-sm text-primary">{t('learner.onboarding.select')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </ResourceView>
    </Dialog>
  );
}

export default function SubjectsPage() {
  const t = useT();
  const { toast } = useToast();
  const res = useResource(useCallback(load, []), []);
  const [picker, setPicker] = useState<{ id: string; title: string } | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);

  async function addSubject(s: OnboardingSubject) {
    setAddingId(s.id);
    try {
      await saveLearningIntent(s.id); // subject-only intent; user then picks a track
      res.reload();
      setPicker({ id: s.id, title: s.title });
    } catch (e) {
      toast(describeError(e, t), 'error');
    } finally {
      setAddingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('learner.subjects.title')}</h1>
        <p className="mt-1 text-muted">{t('learner.subjects.subtitle')}</p>
      </div>

      <ResourceView loading={res.loading} error={res.error} data={res.data} onRetry={res.reload}>
        {(d) => {
          const chosenIds = new Set(d.intents.map((i) => i.subject.id));
          const available = d.subjects.filter((s) => !chosenIds.has(s.id));
          return (
            <>
              <section>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{t('learner.subjects.current')}</h2>
                {d.intents.length === 0 ? (
                  <Card className="p-6 text-muted">{t('learner.subjects.empty')}</Card>
                ) : (
                  <ul className="space-y-2">
                    {d.intents.map((i) => (
                      <li key={i.id}>
                        <Card className="flex items-center justify-between gap-3 p-4">
                          <div className="min-w-0">
                            <div className="truncate font-medium text-text">{i.subject.title}</div>
                            <div className="truncate text-sm text-muted">{i.track ? i.track.title : t('learner.subjects.noTrack')}</div>
                          </div>
                          <Button size="sm" variant="secondary" onClick={() => setPicker({ id: i.subject.id, title: i.subject.title })}>
                            {i.track ? t('learner.subjects.change') : t('learner.subjects.chooseTrack')}
                          </Button>
                        </Card>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{t('learner.subjects.available')}</h2>
                {available.length === 0 ? (
                  <Card className="p-6 text-muted">{t('learner.subjects.empty')}</Card>
                ) : (
                  <ul className="space-y-2">
                    {available.map((s) => (
                      <li key={s.id}>
                        <Card className="flex items-center justify-between gap-3 p-4">
                          <div className="min-w-0">
                            <div className="truncate font-medium text-text">{s.title}</div>
                            {s.description && <div className="truncate text-sm text-muted">{s.description}</div>}
                          </div>
                          <Button size="sm" leftIcon={<FiPlus aria-hidden />} loading={addingId === s.id} disabled={addingId === s.id} onClick={() => addSubject(s)}>
                            {t('learner.subjects.add')}
                          </Button>
                        </Card>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          );
        }}
      </ResourceView>

      {picker && <TrackDialog subjectId={picker.id} subjectTitle={picker.title} open onClose={() => setPicker(null)} onDone={res.reload} />}
    </div>
  );
}
