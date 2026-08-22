'use client';

import { useCallback, useState } from 'react';
import { FiEye, FiMonitor, FiSmartphone } from 'react-icons/fi';
import { getPreview } from '@/lib/api/content';
import { useResource } from '@/lib/hooks/use-resource';
import { useRevisionEditor } from '@/lib/cms/revision-editor-context';
import { useT } from '@/lib/i18n/i18n-context';
import { toSafePreviewActivity, type SafePreviewActivity } from '@/lib/activity/preview-view-model';
import { Card } from '@/components/ui';
import { ResourceView } from '@/components/ui/states';
import { MarkdownPreview } from '@/components/activity/MarkdownPreview';

/**
 * Learner preview panel. Renders the ALLOWLIST safe view model (toSafePreviewActivity) — it never reads or renders
 * answerKey / correctOptionIds / storageKey, and never stringifies the raw preview payload.
 */
function SafeActivityView({ a, emptyOption, mediaNote }: { a: SafePreviewActivity; emptyOption: string; mediaNote: string }) {
  if (a.kind === 'markdown') return <MarkdownPreview markdown={a.markdown} />;
  if (a.kind === 'objective') {
    return (
      <div className="space-y-2">
        <p className="font-medium text-text">{a.prompt || '—'}</p>
        <ul className="space-y-1">
          {a.options.map((o) => (
            <li key={o.id} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text">
              {o.text || <span className="text-muted">{emptyOption}</span>}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (a.kind === 'media') return <p className="text-sm text-muted">{mediaNote}</p>;
  return <p className="text-sm text-muted">{a.type}</p>;
}

export function LearnerPreview() {
  const { revision } = useRevisionEditor();
  const t = useT();
  const res = useResource(useCallback(() => getPreview(revision.id), [revision.id]), [revision.id, revision.updatedAt]);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FiEye className="text-primary" aria-hidden />
          <h3 className="text-sm font-semibold text-text">{t('preview.title')}</h3>
        </div>
        <div className="inline-flex rounded-lg border border-border p-0.5">
          <button type="button" onClick={() => setDevice('desktop')} aria-pressed={device === 'desktop'} title={t('preview.deviceDesktop')} className={`grid h-7 w-8 place-items-center rounded ${device === 'desktop' ? 'bg-surface-2 text-text' : 'text-muted'}`}>
            <FiMonitor aria-hidden />
          </button>
          <button type="button" onClick={() => setDevice('mobile')} aria-pressed={device === 'mobile'} title={t('preview.deviceMobile')} className={`grid h-7 w-8 place-items-center rounded ${device === 'mobile' ? 'bg-surface-2 text-text' : 'text-muted'}`}>
            <FiSmartphone aria-hidden />
          </button>
        </div>
      </div>
      <p className="text-xs text-muted">{t('preview.subtitle')}</p>
      <ResourceView loading={res.loading} error={res.error} data={res.data} onRetry={res.reload}>
        {(preview) => (
          <div className={`space-y-3 ${device === 'mobile' ? 'mx-auto max-w-xs rounded-card border border-border bg-surface-2 p-3' : ''}`}>
            <div>
              <h4 className="font-semibold text-text">{preview.title}</h4>
              {preview.description && <p className="text-sm text-muted">{preview.description}</p>}
            </div>
            {preview.activities.length === 0 ? (
              <p className="text-sm text-muted">{t('preview.noActivities')}</p>
            ) : (
              <ol className="space-y-2">
                {preview.activities.map((raw) => {
                  const safe = toSafePreviewActivity(raw);
                  return (
                    <li key={safe.id}>
                      <Card className="p-3">
                        <SafeActivityView a={safe} emptyOption={t('preview.emptyOption')} mediaNote={t('preview.mediaNote', { type: safe.type })} />
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
