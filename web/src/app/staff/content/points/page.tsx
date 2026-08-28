'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n/i18n-context';
import { useCapabilities } from '@/lib/cms/cms-context';
import { useResource } from '@/lib/hooks/use-resource';
import { describeError } from '@/lib/ui/error-text';
import { listSubjects } from '@/lib/api/content';
import { createPoint, listPoints, listSubjectLevels, type LevelSummary, type PointListItem } from '@/lib/api/point-studio';
import { StudioHeader } from '@/components/shell/StudioHeader';
import { Button, Card, Field, Input, Select, Textarea } from '@/components/ui';
import { ResourceView, EmptyState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { Dialog } from '@/components/ui/dialog';

export default function PointStudioLanding() {
  const t = useT();
  const caps = useCapabilities();
  const subjectsRes = useResource(useCallback(() => listSubjects(), []), []);
  const [subjectId, setSubjectId] = useState('');

  return (
    <div className="space-y-6">
      <StudioHeader title={t('pointStudio.title')} meta={t('pointStudio.subtitle')} />
      {!caps.author ? (
        <Card className="p-6"><p className="text-muted">{t('pointStudio.forbidden')}</p></Card>
      ) : (
        <ResourceView loading={subjectsRes.loading} error={subjectsRes.error} data={subjectsRes.data} onRetry={subjectsRes.reload}>
          {(subjects) => (
            <div className="space-y-5">
              <Field label={t('pointStudio.pickSubject')}>
                <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                  <option value="">—</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </Select>
              </Field>
              {subjectId && <LevelPoints subjectId={subjectId} canAuthor={caps.author} />}
            </div>
          )}
        </ResourceView>
      )}
    </div>
  );
}

function LevelPoints({ subjectId, canAuthor }: { subjectId: string; canAuthor: boolean }) {
  const t = useT();
  const levelsRes = useResource(useCallback(() => listSubjectLevels(subjectId), [subjectId]), [subjectId]);
  const [levelId, setLevelId] = useState('');
  const levels = levelsRes.data ?? [];
  const level = useMemo(() => levels.find((l) => l.id === levelId) ?? null, [levels, levelId]);

  return (
    <ResourceView loading={levelsRes.loading} error={levelsRes.error} data={levelsRes.data} onRetry={levelsRes.reload} isEmpty={(d) => d.length === 0} empty={<EmptyState title={t('pointStudio.noLevels')} />}>
      {(ls) => (
        <div className="space-y-5">
          <Field label={t('pointStudio.pickLevel')}>
            <Select value={levelId} onChange={(e) => setLevelId(e.target.value)}>
              <option value="">—</option>
              {ls.map((l: LevelSummary) => (
                <option key={l.id} value={l.id}>{l.track.title} · {l.code}</option>
              ))}
            </Select>
          </Field>
          {level && <PointsList level={level} canAuthor={canAuthor} />}
        </div>
      )}
    </ResourceView>
  );
}

function PointsList({ level, canAuthor }: { level: LevelSummary; canAuthor: boolean }) {
  const t = useT();
  const router = useRouter();
  const res = useResource(useCallback(() => listPoints(level.id), [level.id]), [level.id]);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{level.track.title} · {level.code}</h2>
        {canAuthor && <Button onClick={() => setDialogOpen(true)}>{t('pointStudio.createPoint')}</Button>}
      </div>
      <ResourceView loading={res.loading} error={res.error} data={res.data} onRetry={res.reload} isEmpty={(d) => d.length === 0} empty={<EmptyState title={t('pointStudio.noPoints')} />}>
        {(points) => (
          <ul className="space-y-2">
            {points.map((p: PointListItem) => (
              <li key={p.id}>
                <button type="button" onClick={() => router.push(`/staff/content/points/${p.id}`)} className="flex w-full items-center justify-between rounded-card border border-border bg-surface p-4 text-left hover:bg-surface-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{p.title}</div>
                    <div className="text-xs text-muted">{p.pointKey}</div>
                  </div>
                  <StatusBadge status={p.editableStatus ?? p.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </ResourceView>
      {dialogOpen && <CreatePointDialog levelId={level.id} onClose={() => setDialogOpen(false)} onCreated={(id) => router.push(`/staff/content/points/${id}`)} />}
    </div>
  );
}

function CreatePointDialog({ levelId, onClose, onCreated }: { levelId: string; onClose: () => void; onCreated: (pointId: string) => void }) {
  const t = useT();
  const [pointKey, setPointKey] = useState('');
  const [title, setTitle] = useState('');
  const [canDo, setCanDo] = useState('');
  const [sortOrder, setSortOrder] = useState('10');
  const [effort, setEffort] = useState('20');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const detail = await createPoint(levelId, { pointKey, title, canDo: canDo.split('\n').map((s) => s.trim()).filter(Boolean), sortOrderDefault: Number(sortOrder) || 0, estimatedEffortMin: Number(effort) || undefined });
      onCreated(detail.point.id);
    } catch (e) {
      setError(describeError(e, t));
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={t('pointStudio.createPoint')} footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button loading={busy} disabled={busy || !pointKey || !title} onClick={submit}>{t('pointStudio.createPoint')}</Button></>}>
      <div className="space-y-3">
        {error && <p role="alert" className="rounded-control bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p>}
        <Field label={t('pointStudio.pointKey')}><Input value={pointKey} onChange={(e) => setPointKey(e.target.value.toUpperCase())} placeholder="ENG-A1-VERB-BE" /></Field>
        <Field label={t('pointStudio.fields.title')}><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label={t('pointStudio.fields.canDo')}><Textarea rows={3} value={canDo} onChange={(e) => setCanDo(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('pointStudio.fields.sortOrder')}><Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></Field>
          <Field label={t('pointStudio.fields.effort')}><Input type="number" value={effort} onChange={(e) => setEffort(e.target.value)} /></Field>
        </div>
      </div>
    </Dialog>
  );
}
