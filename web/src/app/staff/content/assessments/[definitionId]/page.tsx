'use client';

import { useCallback, useState } from 'react';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { getAssessmentDefinition } from '@/lib/api/assessments';
import { useCapabilities } from '@/lib/cms/cms-context';
import { useResource } from '@/lib/hooks/use-resource';
import { useT } from '@/lib/i18n/i18n-context';
import { Button, Card, ErrorState, LoadingRows } from '@/components/ui';
import { StudioHeader } from '@/components/shell/StudioHeader';
import { AssessmentVersionList } from '@/components/assessment/AssessmentVersionList';
import { AssessmentVersionWorkspace } from '@/components/assessment/AssessmentVersionWorkspace';
import { AssessmentDefinitionEditor } from '@/components/assessment/AssessmentDefinitionEditor';
import { fadeInUp } from '@/lib/motion/motion';

export default function AssessmentBuilderPage() {
  const params = useParams<{ definitionId: string }>();
  const definitionId = params.definitionId;
  const t = useT();
  const caps = useCapabilities();
  const res = useResource(useCallback(() => getAssessmentDefinition(definitionId), [definitionId]), [definitionId]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  if (res.loading && !res.data) return <LoadingRows rows={4} />;
  if (res.error && !res.data) return <ErrorState error={res.error} onRetry={res.reload} />;
  const data = res.data;
  if (!data) return <ErrorState error={res.error} onRetry={res.reload} />;
  const { definition, versions } = data;

  // Prefer the editable draft/review version, else the current published one, else the newest.
  const editableVersion = versions.find((v) => v.status === 'DRAFT' || v.status === 'REVIEW');
  const effectiveSelected = selectedVersionId ?? editableVersion?.id ?? definition.currentVersionId ?? versions[0]?.id ?? null;

  return (
    <motion.div variants={fadeInUp} initial="initial" animate="animate" className="mx-auto max-w-6xl space-y-5">
      <StudioHeader
        breadcrumb={[{ label: t('assessmentBuilder.title'), href: '/staff/content/assessments' }]}
        title={definition.title}
        status={definition.status}
        meta={t('assessmentBuilder.purposeDiagnostic')}
        actions={caps.author ? (
          <Button size="sm" variant="secondary" onClick={() => setEditOpen(true)}>{t('assessmentBuilder.editDefinition')}</Button>
        ) : undefined}
      />

      <div className="grid gap-5 lg:grid-cols-4">
        <div className="lg:col-span-1">
          <AssessmentVersionList
            definition={definition}
            versions={versions}
            selectedVersionId={effectiveSelected}
            onSelect={setSelectedVersionId}
            onCreated={(detail) => {
              setSelectedVersionId(detail.version.id);
              res.reload();
            }}
          />
        </div>
        <div className="lg:col-span-3">
          {effectiveSelected ? (
            <AssessmentVersionWorkspace key={effectiveSelected} versionId={effectiveSelected} subjectId={definition.subjectId} onWorkflowDone={res.reload} />
          ) : (
            <Card className="p-6 text-center text-sm text-muted">{t('assessmentBuilder.selectVersion')}</Card>
          )}
        </div>
      </div>

      <AssessmentDefinitionEditor open={editOpen} onClose={() => setEditOpen(false)} definition={definition} onSaved={() => res.reload()} />
    </motion.div>
  );
}
