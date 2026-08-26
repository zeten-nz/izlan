'use client';

import { useEffect, useState } from 'react';
import { FiImage, FiVolume2 } from 'react-icons/fi';
import { useT } from '@/lib/i18n/i18n-context';
import { fetchMediaObjectUrl } from '@/lib/api/media';
import type { LearnerMedia } from '@/lib/api/types';

/**
 * Renders attached lesson media. Bytes are fetched through the AUTHENTICATED transport (the access token is memory-only,
 * so a plain <img src>/<audio src> to the protected endpoint would 401) into a Blob object URL, which is revoked on
 * change/unmount. A media fetch failure NEVER breaks the lesson — it shows a small local error; the rest of the activity
 * stays usable (§19). No autoplay; native accessible audio controls (§18).
 */
export function LessonMedia({ media }: { media?: LearnerMedia[] }) {
  if (!media || media.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {media.map((m) => (
        <MediaItem key={m.id} item={m} />
      ))}
    </div>
  );
}

function MediaItem({ item }: { item: LearnerMedia }) {
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let created: string | null = null;
    setUrl(null);
    setFailed(false);
    fetchMediaObjectUrl(item.id)
      .then((objectUrl) => {
        if (!active) {
          URL.revokeObjectURL(objectUrl); // unmounted before resolve — never leak
          return;
        }
        created = objectUrl;
        setUrl(objectUrl);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [item.id, attempt]);

  if (failed) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 rounded-panel border border-dashed border-border bg-surface-2 p-4 text-sm text-muted">
        <span className="inline-flex items-center gap-2">
          {item.kind === 'audio' ? <FiVolume2 aria-hidden /> : <FiImage aria-hidden />}
          {t('learner.lesson.media.error')}
        </span>
        <button type="button" onClick={() => setAttempt((a) => a + 1)} className="font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          {t('common.reload')}
        </button>
      </div>
    );
  }

  if (!url) {
    return (
      <div className="grid min-h-[80px] place-items-center rounded-panel border border-border bg-surface-2 text-muted" role="status" aria-live="polite" aria-label={t('learner.lesson.media.loading')}>
        <span className="animate-pulse text-sm">{t('learner.lesson.media.loading')}</span>
      </div>
    );
  }

  if (item.kind === 'image') {
    return (
      <img
        src={url}
        alt={item.altText ?? ''}
        className="max-h-[360px] w-full rounded-panel border border-border bg-surface object-contain"
      />
    );
  }

  if (item.kind === 'audio') {
    return (
      <figure className="flex flex-col gap-1.5 rounded-panel border border-border bg-surface p-3">
        {item.altText && <figcaption className="text-[13px] font-medium text-muted">{item.altText}</figcaption>}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio controls preload="none" src={url} className="w-full" aria-label={item.altText ?? t('learner.lesson.media.audioLabel')} />
      </figure>
    );
  }

  return null;
}
