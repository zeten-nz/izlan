'use client';

import { useState } from 'react';
import type { ActivityType } from '@/lib/api/types';
import { MARKDOWN_TYPES, OBJECTIVE_TYPES, activityTypeLabelKey } from '@/lib/activity/activity-meta';
import { serializeMarkdownPayload } from '@/lib/activity/markdown-serializer';
import { serializeObjectivePayload } from '@/lib/activity/objective-serializer';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui';
import { useT } from '@/lib/i18n/i18n-context';

/** Default VALID payload for a new activity so create-time validation passes; the author then edits it. */
export function defaultPayloadFor(type: ActivityType): unknown {
  if (MARKDOWN_TYPES.includes(type)) return serializeMarkdownPayload('Yangi matn');
  return serializeObjectivePayload({
    format: 'single_choice',
    prompt: 'Yangi savol',
    options: [
      { id: 'o1', text: 'Variant 1' },
      { id: 'o2', text: 'Variant 2' },
    ],
    correctOptionIds: ['o1'],
  });
}

/** Only markdown + objective types are creatable (media deferred; unsupported never creatable). */
export function AddActivityDialog({ open, onClose, onPick, busy }: { open: boolean; onClose: () => void; onPick: (type: ActivityType) => void; busy: boolean }) {
  const t = useT();
  const [selected, setSelected] = useState<ActivityType | null>(null);

  function Group({ title, types }: { title: string; types: readonly ActivityType[] }) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {types.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setSelected(type)}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${selected === type ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-surface hover:bg-surface-2'}`}
            >
              {t(activityTypeLabelKey(type))}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('activity.addTitle')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!selected} loading={busy} onClick={() => selected && onPick(selected)}>
            {t('common.add')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Group title={t('activity.markdownGroup')} types={MARKDOWN_TYPES} />
        <Group title={t('activity.objectiveGroup')} types={OBJECTIVE_TYPES} />
        <p className="text-xs text-muted">{t('activity.otherNote')}</p>
      </div>
    </Dialog>
  );
}
