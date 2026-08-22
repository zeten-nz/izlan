'use client';

import { useState } from 'react';
import { FiEye, FiSave } from 'react-icons/fi';
import { serializeMarkdownPayload, markdownValidationError } from '@/lib/activity/markdown-serializer';
import { useT } from '@/lib/i18n/i18n-context';
import { Button, Field, Textarea } from '@/components/ui';
import { Badge } from '@/components/ui/status-badge';
import { MarkdownPreview } from './MarkdownPreview';

/** Editor for TEXT/EXPLANATION/EXAMPLE (lesson-activity-markdown/v1). Split preview; raw HTML never enabled. */
export function MarkdownActivityEditor({
  initialMarkdown,
  initialDuration,
  editable,
  committing,
  onCommit,
}: {
  initialMarkdown: string;
  initialDuration: number | null;
  editable: boolean;
  committing: boolean;
  onCommit: (payload: unknown, durationMin: number | undefined) => Promise<void>;
}) {
  const t = useT();
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [duration, setDuration] = useState(initialDuration === null ? '' : String(initialDuration));
  const [showPreview, setShowPreview] = useState(true);
  const dirty = markdown !== initialMarkdown || duration !== (initialDuration === null ? '' : String(initialDuration));
  const errObj = markdownValidationError(markdown);
  const error = errObj ? t(errObj.key, errObj.vars) : null;

  if (!editable) {
    return (
      <div className="space-y-2">
        <MarkdownPreview markdown={initialMarkdown} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <Field label={t('activity.markdownLabel')} htmlFor="md" error={error}>
          <Textarea id="md" rows={8} value={markdown} onChange={(e) => setMarkdown(e.target.value)} className="font-mono" />
        </Field>
        {showPreview && (
          <div>
            <span className="mb-1.5 block text-sm font-medium text-text">{t('activity.previewLabel')}</span>
            <div className="min-h-[8rem] rounded-lg border border-border bg-surface-2 p-3">
              <MarkdownPreview markdown={markdown} />
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label htmlFor="md-dur" className="text-xs text-muted">
            {t('activity.durationLabel')}
          </label>
          <input id="md-dur" type="number" min={0} value={duration} onChange={(e) => setDuration(e.target.value)} className="h-8 w-24 rounded-lg border border-border bg-surface px-2 text-sm" />
          {dirty && <Badge tone="warning">{t('common.unsaved')}</Badge>}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" leftIcon={<FiEye aria-hidden />} onClick={() => setShowPreview((p) => !p)}>
            {showPreview ? t('activity.previewHide') : t('activity.previewToggle')}
          </Button>
          <Button
            size="sm"
            leftIcon={<FiSave aria-hidden />}
            loading={committing}
            disabled={!!error || !dirty}
            onClick={() => onCommit(serializeMarkdownPayload(markdown), duration.trim() === '' ? undefined : Number(duration))}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
