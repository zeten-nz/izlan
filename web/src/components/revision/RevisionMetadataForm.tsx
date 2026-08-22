'use client';

import { useEffect, useState } from 'react';
import { FiSave } from 'react-icons/fi';
import { updateRevision } from '@/lib/api/content';
import { useRevisionEditor } from '@/lib/cms/revision-editor-context';
import { useT } from '@/lib/i18n/i18n-context';
import { Button, Card, Field, Input, Textarea, useToast } from '@/components/ui';
import { Badge } from '@/components/ui/status-badge';
import { ConflictBanner } from '@/components/ui/conflict-banner';
import { isEditConflict } from '@/lib/api/errors';
import { describeError } from '@/lib/ui/error-text';

/** Revision title/description editor (DRAFT only). estimatedDurationMin is server-owned (read-only display). */
export function RevisionMetadataForm({ editable, onReload }: { editable: boolean; onReload: () => void }) {
  const { revision, setRevision } = useRevisionEditor();
  const t = useT();
  const { toast } = useToast();
  const [title, setTitle] = useState(revision.title);
  const [description, setDescription] = useState(revision.description ?? '');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    setTitle(revision.title);
    setDescription(revision.description ?? '');
  }, [revision.title, revision.description]);

  const dirty = title !== revision.title || description !== (revision.description ?? '');

  async function save() {
    setBusy(true);
    setConflict(false);
    try {
      const updated = await updateRevision(revision.id, {
        expectedUpdatedAt: revision.updatedAt,
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
      });
      setRevision(updated);
      toast(t('common.saved'), 'success');
    } catch (e) {
      if (isEditConflict(e)) setConflict(true);
      else toast(describeError(e, t), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 p-4">
      {conflict && <ConflictBanner onReload={() => { setConflict(false); onReload(); }} onCancel={() => setConflict(false)} />}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{t('revision.metaTitle')}</h3>
        {editable && dirty && <Badge tone="warning">{t('common.unsaved')}</Badge>}
      </div>
      {editable ? (
        <>
          <Field label={t('revision.title')} htmlFor="rev-title">
            <Input id="rev-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t('revision.description')} htmlFor="rev-desc">
            <Textarea id="rev-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">{t('revision.durationServer', { n: revision.estimatedDurationMin ?? '—' })}</span>
            <Button size="sm" leftIcon={<FiSave aria-hidden />} loading={busy} disabled={!dirty || title.trim().length === 0} onClick={save}>
              {t('common.save')}
            </Button>
          </div>
        </>
      ) : (
        <div className="space-y-1 text-sm">
          <p className="font-medium text-text">{revision.title}</p>
          {revision.description && <p className="text-muted">{revision.description}</p>}
          <p className="text-xs text-muted">{t('revision.duration', { n: revision.estimatedDurationMin ?? '—' })}</p>
        </div>
      )}
    </Card>
  );
}
