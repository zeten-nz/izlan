'use client';

import { useCallback, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { FiChevronRight, FiEye, FiCheckSquare } from 'react-icons/fi';
import { getLesson, getRevision } from '@/lib/api/content';
import { resolveLessonSubjectId } from '@/lib/api/hierarchy-helpers';
import type { Revision } from '@/lib/api/types';
import { useResource } from '@/lib/hooks/use-resource';
import { useCapabilities } from '@/lib/cms/cms-context';
import { useT } from '@/lib/i18n/i18n-context';
import { RevisionEditorProvider, useRevisionEditor } from '@/lib/cms/revision-editor-context';
import { fadeInUp } from '@/lib/motion/motion';
import { Card } from '@/components/ui';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tabs } from '@/components/ui/tabs';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { RevisionMetadataForm } from '@/components/revision/RevisionMetadataForm';
import { ActivitiesEditor } from '@/components/activity/ActivitiesEditor';
import { ReadinessPanel } from '@/components/revision/ReadinessPanel';
import { LearnerPreview } from '@/components/revision/LearnerPreview';
import { WorkflowActions } from '@/components/revision/WorkflowActions';

function EditorInner() {
  const { revision, setRevision } = useRevisionEditor();
  const caps = useCapabilities();
  const t = useT();
  const lessonRes = useResource(useCallback(() => getLesson(revision.lessonId), [revision.lessonId]), [revision.lessonId]);
  const subjectRes = useResource(
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useCallback(() => (lessonRes.data ? resolveLessonSubjectId(lessonRes.data) : Promise.reject(new Error('no lesson'))), [lessonRes.data?.topicId]),
    [lessonRes.data?.topicId],
  );
  const [rail, setRail] = useState('readiness');

  const reload = useCallback(async () => {
    const fresh = await getRevision(revision.id);
    setRevision(fresh);
  }, [revision.id, setRevision]);

  const editable = revision.status === 'DRAFT' && caps.author;
  const subjectId = subjectRes.data ?? '';

  return (
    <motion.div variants={fadeInUp} initial="initial" animate="animate" className="mx-auto max-w-6xl space-y-5">
      <nav aria-label={t('hierarchy.breadcrumbLabel')} className="flex flex-wrap items-center gap-1 text-sm text-muted">
        <Link href="/staff/content" className="transition-colors hover:text-text">
          {t('nav.subjects')}
        </Link>
        <FiChevronRight aria-hidden />
        <Link href={`/staff/content/lessons/${revision.lessonId}`} className="transition-colors hover:text-text">
          {lessonRes.data?.contentKey ?? t('hierarchy.lessons')}
        </Link>
        <FiChevronRight aria-hidden />
        <span className="font-semibold text-text">v{revision.version}</span>
        <StatusBadge status={revision.status} />
        {!editable && revision.status !== 'DRAFT' && <span className="ml-2 text-xs text-muted">{t('revision.freezeNote')}</span>}
      </nav>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <RevisionMetadataForm editable={editable} onReload={() => void reload()} />
          <ActivitiesEditor revisionId={revision.id} subjectId={subjectId} editable={editable} />
        </div>

        <div className="space-y-5">
          <Card className="p-4">
            <WorkflowActions onReload={() => void reload()} />
          </Card>
          <Card className="p-4">
            <Tabs
              tabs={[
                { key: 'readiness', label: t('tabs.readiness'), icon: <FiCheckSquare aria-hidden /> },
                { key: 'preview', label: t('tabs.preview'), icon: <FiEye aria-hidden /> },
              ]}
              active={rail}
              onChange={setRail}
            />
            <div className="pt-3">
              {rail === 'readiness' && <ReadinessPanel />}
              {rail === 'preview' && <LearnerPreview />}
            </div>
          </Card>
        </div>
      </div>
    </motion.div>
  );
}

export default function RevisionEditorPage() {
  const params = useParams<{ revisionId: string }>();
  const revisionId = params.revisionId;
  const res = useResource(useCallback(() => getRevision(revisionId), [revisionId]), [revisionId]);

  if (res.loading && !res.data) return <LoadingRows rows={5} />;
  if (res.error && !res.data) return <ErrorState error={res.error} onRetry={res.reload} />;
  const revision: Revision | null = res.data;
  if (!revision) return <ErrorState error={res.error} onRetry={res.reload} />;

  return (
    <RevisionEditorProvider initial={revision}>
      <EditorInner />
    </RevisionEditorProvider>
  );
}
