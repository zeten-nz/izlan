'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { FiClipboard } from 'react-icons/fi';
import { listSubjects } from '@/lib/api/content';
import { ensureAssessmentDefinition, getSubjectAssessments } from '@/lib/api/assessments';
import { useCapabilities } from '@/lib/cms/cms-context';
import { useResource } from '@/lib/hooks/use-resource';
import { useT } from '@/lib/i18n/i18n-context';
import { Button, Card, EmptyState, ResourceView, useToast } from '@/components/ui';
import { StudioHeader } from '@/components/shell/StudioHeader';
import { fadeInUp } from '@/lib/motion/motion';
import { describeError } from '@/lib/ui/error-text';

/**
 * Assessment Builder entry — the Methodist's assigned subjects. Opening a subject resolves its diagnostic definition
 * (or creates it, author-only) and navigates to the builder. There is no global "current subject" store — the subject
 * is chosen here and lives in the builder route's definition.
 */
export default function AssessmentsListPage() {
  const t = useT();
  const router = useRouter();
  const caps = useCapabilities();
  const { toast } = useToast();
  const res = useResource(useCallback(() => listSubjects(), []), []);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function open(subjectId: string) {
    setBusyId(subjectId);
    try {
      const view = await getSubjectAssessments(subjectId);
      if (view.definition) {
        router.push(`/staff/content/assessments/${view.definition.id}`);
        return;
      }
      if (!caps.author) {
        toast(t('assessmentBuilder.noDiagnostic'), 'info');
        setBusyId(null);
        return;
      }
      const def = await ensureAssessmentDefinition(subjectId);
      router.push(`/staff/content/assessments/${def.id}`);
    } catch (e) {
      toast(describeError(e, t), 'error');
      setBusyId(null);
    }
  }

  return (
    <motion.div variants={fadeInUp} initial="initial" animate="animate" className="mx-auto max-w-5xl space-y-5">
      <StudioHeader title={t('assessmentBuilder.title')} meta={t('assessmentBuilder.subtitle')} />
      <ResourceView
        loading={res.loading}
        error={res.error}
        data={res.data}
        onRetry={res.reload}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title={t('assessmentBuilder.subjectsEmptyTitle')} message={t('assessmentBuilder.subjectsEmptyBody')} />}
      >
        {(subjects) => (
          <div className="grid gap-3 sm:grid-cols-2">
            {subjects.map((s) => (
              <Card key={s.id} className="flex items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-primary-tint text-primary">
                    <FiClipboard aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-text">{s.title}</p>
                    <p className="truncate text-xs text-muted">{s.slug}</p>
                  </div>
                </div>
                <Button size="sm" variant="secondary" loading={busyId === s.id} onClick={() => open(s.id)}>
                  {t('assessmentBuilder.openBuilder')}
                </Button>
              </Card>
            ))}
          </div>
        )}
      </ResourceView>
    </motion.div>
  );
}
