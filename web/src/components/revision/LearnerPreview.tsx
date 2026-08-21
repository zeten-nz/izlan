'use client';

import { useCallback } from 'react';
import { FiEye } from 'react-icons/fi';
import { getPreview } from '@/lib/api/content';
import { useResource } from '@/lib/hooks/use-resource';
import { useRevisionEditor } from '@/lib/cms/revision-editor-context';
import { toSafePreviewActivity, type SafePreviewActivity } from '@/lib/activity/preview-view-model';
import { Card } from '@/components/ui';
import { ResourceView } from '@/components/ui/states';
import { MarkdownPreview } from '@/components/activity/MarkdownPreview';

/**
 * Learner preview panel. Renders the ALLOWLIST safe view model (toSafePreviewActivity) — it never reads or renders
 * answerKey / correctOptionIds / storageKey, and never stringifies the raw preview payload.
 */
function SafeActivityView({ a }: { a: SafePreviewActivity }) {
  if (a.kind === 'markdown') return <MarkdownPreview markdown={a.markdown} />;
  if (a.kind === 'objective') {
    return (
      <div className="space-y-2">
        <p className="font-medium text-text">{a.prompt || '—'}</p>
        <ul className="space-y-1">
          {a.options.map((o) => (
            <li key={o.id} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text">
              {o.text || <span className="text-muted">(bo‘sh)</span>}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (a.kind === 'media') return <p className="text-sm text-muted">Media ({a.type}) — o‘quvchi ko‘rinishi (fayl keyingi bosqichda).</p>;
  return <p className="text-sm text-muted">{a.type}</p>;
}

export function LearnerPreview() {
  const { revision } = useRevisionEditor();
  const res = useResource(useCallback(() => getPreview(revision.id), [revision.id]), [revision.id, revision.updatedAt]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <FiEye className="text-primary" aria-hidden />
        <h3 className="text-sm font-semibold text-text">O‘quvchi ko‘rinishi (Learner preview)</h3>
      </div>
      <p className="text-xs text-muted">Bu o‘quvchi ko‘radigan xavfsiz ko‘rinish — javob kaliti (answerKey) bu yerda ko‘rsatilmaydi.</p>
      <ResourceView loading={res.loading} error={res.error} data={res.data} onRetry={res.reload}>
        {(preview) => (
          <div className="space-y-3">
            <div>
              <h4 className="font-semibold text-text">{preview.title}</h4>
              {preview.description && <p className="text-sm text-muted">{preview.description}</p>}
            </div>
            {preview.activities.length === 0 ? (
              <p className="text-sm text-muted">Faoliyat yo‘q.</p>
            ) : (
              <ol className="space-y-2">
                {preview.activities.map((raw) => {
                  const safe = toSafePreviewActivity(raw);
                  return (
                    <li key={safe.id}>
                      <Card className="p-3">
                        <SafeActivityView a={safe} />
                      </Card>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}
      </ResourceView>
    </div>
  );
}
