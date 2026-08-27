'use client';

import { useCallback } from 'react';
import { FiCheckCircle, FiXCircle, FiAlertTriangle } from 'react-icons/fi';
import { getAssessmentReadiness } from '@/lib/api/assessments';
import type { Skill } from '@/lib/api/types';
import { useResource } from '@/lib/hooks/use-resource';
import { useT } from '@/lib/i18n/i18n-context';
import { Card, Spinner, Badge } from '@/components/ui';
import { describeError } from '@/lib/ui/error-text';

/**
 * Readiness + coverage panel. Stable machine codes → localized labels; blockers gate publish (danger), an uncovered
 * ACTIVE subject skill is a WARNING only (never a blocker). Refetches whenever `reloadKey` changes (after any item/
 * config edit). Skill ids are resolved to names via the subject's skill list.
 */
export function AssessmentReadinessPanel({ versionId, reloadKey, skills }: { versionId: string; reloadKey: string; skills: Skill[] }) {
  const t = useT();
  const res = useResource(useCallback(() => getAssessmentReadiness(versionId), [versionId]), [versionId, reloadKey]);
  const skillName = (id?: string) => (id ? skills.find((s) => s.id === id)?.name ?? id : '');
  const label = (code: string) => t(`assessmentBuilder.${code}`);

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">{t('assessmentBuilder.readinessTitle')}</h3>
        {res.data &&
          (res.data.publishReady ? (
            <span className="flex items-center gap-1.5 text-sm font-medium text-success">
              <FiCheckCircle aria-hidden /> {t('assessmentBuilder.readyToPublish')}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-sm font-medium text-danger">
              <FiXCircle aria-hidden /> {t('assessmentBuilder.notReady')}
            </span>
          ))}
      </div>

      {res.loading && !res.data && <Spinner />}
      {!!res.error && !res.data && <p className="text-sm text-danger">{describeError(res.error, t)}</p>}

      {res.data && (
        <div className="space-y-3">
          {res.data.blockers.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-danger">{t('assessmentBuilder.blockers')}</p>
              <ul className="space-y-1">
                {res.data.blockers.map((b, i) => (
                  <li key={`${b.code}-${i}`} className="flex items-start gap-2 rounded-control border border-danger/30 bg-danger/10 px-3 py-1.5 text-sm text-danger">
                    <FiXCircle aria-hidden className="mt-0.5 shrink-0" />
                    <span>{label(b.code)}{b.skillId ? ` — ${skillName(b.skillId)}` : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {res.data.warnings.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-warning">{t('assessmentBuilder.warnings')}</p>
              <ul className="space-y-1">
                {res.data.warnings.map((w, i) => (
                  <li key={`${w.code}-${i}`} className="flex items-start gap-2 rounded-control border border-warning/30 bg-warning/10 px-3 py-1.5 text-sm text-warning">
                    <FiAlertTriangle aria-hidden className="mt-0.5 shrink-0" />
                    <span>{label(w.code)}{w.skillId ? ` — ${skillName(w.skillId)}` : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-1 rounded-control border border-border bg-surface-2 px-3 py-2 text-sm text-muted">
            <p>
              {t('assessmentBuilder.coverage')}:{' '}
              {t('assessmentBuilder.coveredSkills', { covered: String(res.data.coverage.coveredSkillIds.length), active: String(res.data.coverage.activeSubjectSkillIds.length) })}
            </p>
            {res.data.coverage.requiredItemsPerSkill != null && <p>{t('assessmentBuilder.requiredPerSkill', { n: String(res.data.coverage.requiredItemsPerSkill) })}</p>}
            {res.data.coverage.uncoveredSkillIds.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {res.data.coverage.uncoveredSkillIds.map((id) => (
                  <Badge key={id} tone="warning">{skillName(id)}</Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
