'use client';

import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button, Field, Input, Textarea, useToast } from '@/components/ui';
import { createSubject } from '@/lib/api/content';
import { isApiError } from '@/lib/api/errors';
import { describeError } from '@/lib/ui/error-text';
import { slugify, isValidSlug } from '@/lib/ui/slug';
import { useT } from '@/lib/i18n/i18n-context';

/**
 * Compact Subject-create modal. The slug is auto-derived from the title (staff never has to know slug rules), stays
 * editable, and once the user edits it we stop overwriting their choice. Ordering is NOT asked for — the server
 * assigns it. Validation is explained at the field level before submit, and backend failures are mapped to the field
 * they belong to (invalid slug → under Slug; duplicate → "already exists") instead of one generic error.
 */
export function SubjectCreateDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [slugError, setSlugError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setTitle(''); setSlug(''); setSlugEdited(false); setDescription(''); setSlugError(null); setFormError(null); setBusy(false); }
  }, [open]);

  function onTitleChange(next: string) {
    setTitle(next);
    if (!slugEdited) { setSlug(slugify(next)); setSlugError(null); } // mirror the title until the user takes over the slug
  }
  function onSlugChange(next: string) {
    setSlug(next);
    setSlugEdited(true); // custom slug — never silently overwrite it again
    setSlugError(null);
  }

  const canSubmit = title.trim().length > 0 && slug.trim().length > 0;

  async function submit() {
    const s = slug.trim();
    if (!isValidSlug(s)) { setSlugError(t('subjects.slugInvalid')); return; } // explain the real problem before submit
    setBusy(true);
    setSlugError(null);
    setFormError(null);
    try {
      await createSubject({ slug: s, title: title.trim(), description: description.trim() ? description.trim() : undefined });
      toast(t('subjects.created'), 'success');
      onCreated();
      onClose();
    } catch (e) {
      if (isApiError(e) && e.code === 'CONTENT_UNIQUE_CONFLICT') setSlugError(t('subjects.slugTaken'));
      else if (isApiError(e) && e.status === 400 && /slug/i.test(e.message)) setSlugError(t('subjects.slugInvalid'));
      else setFormError(describeError(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('subjects.newTitle')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>{t('common.create')}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <p className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{formError}</p>}
        <Field label={`${t('subjects.fieldTitle')} *`} htmlFor="subj-title">
          <Input id="subj-title" value={title} onChange={(e) => onTitleChange(e.target.value)} placeholder={t('subjects.titlePlaceholder')} autoFocus />
        </Field>
        <Field label={`${t('subjects.slug')} *`} htmlFor="subj-slug" hint={t('subjects.slugHint')} error={slugError ?? undefined}>
          <Input id="subj-slug" value={slug} onChange={(e) => onSlugChange(e.target.value)} placeholder={t('subjects.slugPlaceholder')} spellCheck={false} autoCapitalize="none" />
        </Field>
        <Field label={t('subjects.description')} htmlFor="subj-desc">
          <Textarea id="subj-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
