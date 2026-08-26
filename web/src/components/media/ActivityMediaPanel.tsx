'use client';

import { useEffect, useRef, useState } from 'react';
import { FiImage, FiTrash2, FiUploadCloud, FiVolume2 } from 'react-icons/fi';
import { useT } from '@/lib/i18n/i18n-context';
import { Button, IconButton, useToast } from '@/components/ui';
import { describeError } from '@/lib/ui/error-text';
import { attachActivityMedia, detachActivityMedia, listActivityMedia, uploadMedia, type AttachedMedia } from '@/lib/api/media';

const ACCEPT = 'image/png,image/jpeg,image/webp,audio/mpeg,audio/wav,audio/ogg';

/**
 * Activity-level media authoring (§12). Upload a single image/audio file + optional alt text, attach it to a DRAFT
 * activity, list attachments, remove one. Mutations rotate the revision token (like skills). Read-only when not editable.
 * Not a media library — no folders/tags/search.
 */
export function ActivityMediaPanel({
  activityId,
  editable,
  revisionUpdatedAt,
  onTokenChange,
}: {
  activityId: string;
  editable: boolean;
  revisionUpdatedAt: string;
  onTokenChange: (token: string) => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const [items, setItems] = useState<AttachedMedia[]>([]);
  const [alt, setAlt] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => listActivityMedia(activityId).then(setItems).catch(() => undefined);
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activityId]);

  async function onPick(file: File | undefined) {
    if (!file) return;
    // Images REQUIRE meaningful alt text (accessibility). Guard client-side so we never upload an orphan asset we then can't attach.
    if (file.type.startsWith('image/') && alt.trim().length === 0) {
      toast(t('activity.media.altRequired'), 'error');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setBusy(true);
    try {
      const uploaded = await uploadMedia(file);
      const r = await attachActivityMedia(activityId, uploaded.id, revisionUpdatedAt, alt);
      onTokenChange(r.revisionUpdatedAt);
      setAlt('');
      await load();
      toast(t('activity.media.attached'), 'success');
    } catch (e) {
      toast(describeError(e, t), 'error');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const r = await detachActivityMedia(activityId, id, revisionUpdatedAt);
      onTokenChange(r.revisionUpdatedAt);
      await load();
    } catch (e) {
      toast(describeError(e, t), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-xs font-semibold text-text">{t('activity.media.label')}</p>

      {items.length === 0 ? (
        <p className="text-xs text-muted">{t('activity.media.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((m) => (
            <li key={m.id} className="flex items-center gap-2 rounded-control border border-border bg-surface px-3 py-2 text-sm">
              {m.kind === 'audio' ? <FiVolume2 aria-hidden className="shrink-0 text-muted" /> : <FiImage aria-hidden className="shrink-0 text-muted" />}
              <span className="min-w-0 flex-1 truncate text-text">{m.altText || t('activity.media.noAlt')}</span>
              <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted">{m.mimeType.split('/')[1]}</span>
              {editable && (
                <IconButton label={t('activity.media.remove')} variant="danger" onClick={() => void remove(m.id)} disabled={busy}>
                  <FiTrash2 aria-hidden />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <div className="flex flex-col gap-2 rounded-control border border-dashed border-border bg-surface-2 p-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-muted">{t('activity.media.altLabel')}</span>
            <input
              type="text"
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              maxLength={500}
              placeholder={t('activity.media.altPlaceholder')}
              className="rounded-control border border-border bg-surface px-2.5 py-1.5 text-sm text-text outline-none focus-visible:border-primary"
            />
          </label>
          <input ref={fileRef} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => void onPick(e.target.files?.[0])} />
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="secondary" loading={busy} disabled={busy} onClick={() => fileRef.current?.click()}>
              <FiUploadCloud aria-hidden /> {t('activity.media.choose')}
            </Button>
            <span className="text-[11px] text-muted">{t('activity.media.hint')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
