'use client';

import { useCallback } from 'react';
import { getAssessmentPreview } from '@/lib/api/assessments';
import { useResource } from '@/lib/hooks/use-resource';
import { useT } from '@/lib/i18n/i18n-context';
import { Card, Spinner } from '@/components/ui';
import { describeError } from '@/lib/ui/error-text';

const LETTERS = 'ABCDEFGHIJ';

/**
 * Learner-safe preview. Renders ONLY the learner projection returned by GET …/preview (prompt + option text) — the
 * answerKey is never fetched here and never rendered, so staff can eyeball exactly what a learner sees. Read-only.
 */
export function AssessmentPreview({ versionId, reloadKey }: { versionId: string; reloadKey: string }) {
  const t = useT();
  const res = useResource(useCallback(() => getAssessmentPreview(versionId), [versionId]), [versionId, reloadKey]);

  return (
    <Card className="space-y-3 p-4">
      <div>
        <h3 className="text-sm font-semibold text-text">{t('assessmentBuilder.previewTitle')}</h3>
        <p className="text-xs text-muted">{t('assessmentBuilder.previewNote')}</p>
      </div>

      {res.loading && !res.data && <Spinner />}
      {!!res.error && !res.data && <p className="text-sm text-danger">{describeError(res.error, t)}</p>}
      {res.data && res.data.items.length === 0 && <p className="text-sm text-muted">{t('assessmentBuilder.previewEmpty')}</p>}

      {res.data && res.data.items.length > 0 && (
        <ol className="space-y-3">
          {res.data.items.map((item, idx) => (
            <li key={item.id} className="rounded-control border border-border bg-surface-2 p-3">
              <p className="text-sm font-medium text-text">
                <span className="text-muted">{idx + 1}.</span> {item.prompt}
              </p>
              {item.options && item.options.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {item.options.map((o, i) => (
                    <li key={o.id} className="flex items-center gap-2 text-sm text-text">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-border text-xs text-muted">{LETTERS[i]}</span>
                      {o.text}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
