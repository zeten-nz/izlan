'use client';

import { useCallback, useState } from 'react';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { FiEdit2, FiLayers, FiTag, FiUploadCloud, FiUsers } from 'react-icons/fi';
import { getSubject, publishSubject, updateSubject } from '@/lib/api/content';
import { useResource } from '@/lib/hooks/use-resource';
import { useCapabilities } from '@/lib/cms/cms-context';
import { useT } from '@/lib/i18n/i18n-context';
import { Button, useToast } from '@/components/ui';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { StudioHeader } from '@/components/shell/StudioHeader';
import { EntityFormDialog, type FormValues } from '@/components/forms/EntityFormDialog';
import { HierarchyNav } from '@/components/hierarchy/HierarchyNav';
import { SkillsManager } from '@/components/subject/SkillsManager';
import { AssignmentsManager } from '@/components/subject/AssignmentsManager';
import { describeError } from '@/lib/ui/error-text';
import { formatDateTime } from '@/lib/ui/format';
import { fadeInUp } from '@/lib/motion/motion';

const s = (v?: string) => (v ?? '').trim();

export default function SubjectWorkspace() {
  const params = useParams<{ subjectId: string }>();
  const subjectId = params.subjectId;
  const caps = useCapabilities();
  const t = useT();
  const { toast } = useToast();
  const res = useResource(useCallback(() => getSubject(subjectId), [subjectId]), [subjectId]);
  const [tab, setTab] = useState('hierarchy');
  const [editing, setEditing] = useState(false);
  const [publishing, setPublishing] = useState(false);

  if (res.loading && !res.data) return <LoadingRows rows={4} />;
  if (res.error && !res.data) return <ErrorState error={res.error} onRetry={res.reload} />;
  const subject = res.data;
  if (!subject) return <ErrorState error={res.error} onRetry={res.reload} />;

  async function onPublish() {
    if (!subject) return;
    setPublishing(true);
    try {
      await publishSubject(subject.id, { expectedUpdatedAt: subject.updatedAt });
      toast(t('subjects.published'), 'success');
      res.reload();
    } catch (e) {
      toast(describeError(e, t), 'error');
      res.reload();
    } finally {
      setPublishing(false);
    }
  }

  const tabs = [
    { key: 'hierarchy', label: t('tabs.hierarchy'), icon: <FiLayers aria-hidden /> },
    { key: 'skills', label: t('tabs.skills'), icon: <FiTag aria-hidden /> },
    ...(caps.subjectManage ? [{ key: 'assignments', label: t('tabs.assignments'), icon: <FiUsers aria-hidden /> }] : []),
  ];

  return (
    <motion.div variants={fadeInUp} initial="initial" animate="animate" className="mx-auto max-w-5xl space-y-5">
      <StudioHeader
        breadcrumb={[{ label: t('nav.subjects'), href: '/staff/content' }]}
        title={subject.title}
        status={subject.status}
        meta={
          <div className="space-y-1">
            <div>/{subject.slug} · {t('common.updatedAt')}: {formatDateTime(subject.updatedAt)}</div>
            {subject.description && <p className="max-w-2xl text-text/80">{subject.description}</p>}
          </div>
        }
        actions={
          <>
            {caps.subjectManage && subject.status === 'DRAFT' && (
              <Button variant="secondary" size="sm" leftIcon={<FiEdit2 aria-hidden />} onClick={() => setEditing(true)}>
                {t('common.edit')}
              </Button>
            )}
            {caps.publish && subject.status === 'DRAFT' && (
              <Button size="sm" leftIcon={<FiUploadCloud aria-hidden />} loading={publishing} onClick={onPublish}>
                {t('workflow.publish')}
              </Button>
            )}
          </>
        }
      />

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <div role="tabpanel">
        {tab === 'hierarchy' && <HierarchyNav subject={subject} />}
        {tab === 'skills' && <SkillsManager subjectId={subject.id} />}
        {tab === 'assignments' && caps.subjectManage && <AssignmentsManager subjectId={subject.id} />}
      </div>

      <EntityFormDialog
        open={editing}
        title={t('subjects.editTitle')}
        fields={[
          { name: 'slug', label: t('subjects.slug'), type: 'text', required: true },
          { name: 'title', label: t('subjects.fieldTitle'), type: 'text', required: true },
          { name: 'description', label: t('subjects.description'), type: 'textarea' },
        ]}
        initial={{ slug: subject.slug, title: subject.title, description: subject.description ?? '' }}
        onSubmit={async (v: FormValues) => {
          await updateSubject(subject.id, {
            expectedUpdatedAt: subject.updatedAt,
            slug: s(v.slug),
            title: s(v.title),
            description: s(v.description) ? s(v.description) : null,
          });
          toast(t('common.saved'), 'success');
          res.reload();
        }}
        onClose={() => setEditing(false)}
        onConflictReload={res.reload}
      />
    </motion.div>
  );
}
