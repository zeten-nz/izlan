'use client';

import { useCallback, useState } from 'react';
import { useParams } from 'next/navigation';
import { FiEdit2, FiLayers, FiTag, FiUploadCloud, FiUsers } from 'react-icons/fi';
import { getSubject, publishSubject, updateSubject } from '@/lib/api/content';
import { useResource } from '@/lib/hooks/use-resource';
import { useCapabilities } from '@/lib/cms/cms-context';
import { Button, Card, useToast } from '@/components/ui';
import { StatusBadge } from '@/components/ui/status-badge';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { EntityFormDialog, type FormValues } from '@/components/forms/EntityFormDialog';
import { HierarchyNav } from '@/components/hierarchy/HierarchyNav';
import { SkillsManager } from '@/components/subject/SkillsManager';
import { AssignmentsManager } from '@/components/subject/AssignmentsManager';
import { describeError } from '@/lib/ui/error-text';
import { formatDateTime } from '@/lib/ui/format';

const s = (v?: string) => (v ?? '').trim();

export default function SubjectWorkspace() {
  const params = useParams<{ subjectId: string }>();
  const subjectId = params.subjectId;
  const caps = useCapabilities();
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
      toast('Fan nashr etildi', 'success');
      res.reload();
    } catch (e) {
      toast(describeError(e), 'error');
      res.reload();
    } finally {
      setPublishing(false);
    }
  }

  const tabs = [
    { key: 'hierarchy', label: 'Ierarxiya', icon: <FiLayers aria-hidden /> },
    { key: 'skills', label: 'Ko‘nikmalar', icon: <FiTag aria-hidden /> },
    ...(caps.subjectManage ? [{ key: 'assignments', label: 'Biriktirmalar', icon: <FiUsers aria-hidden /> }] : []),
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-xl font-bold text-text">{subject.title}</h1>
              <StatusBadge status={subject.status} />
            </div>
            <p className="text-sm text-muted">/{subject.slug}</p>
            {subject.description && <p className="mt-2 max-w-2xl text-sm text-muted">{subject.description}</p>}
            <p className="mt-2 text-xs text-muted">Yangilangan: {formatDateTime(subject.updatedAt)}</p>
          </div>
          <div className="flex gap-2">
            {caps.subjectManage && subject.status === 'DRAFT' && (
              <Button variant="secondary" size="sm" leftIcon={<FiEdit2 aria-hidden />} onClick={() => setEditing(true)}>
                Tahrirlash
              </Button>
            )}
            {caps.publish && subject.status === 'DRAFT' && (
              <Button size="sm" leftIcon={<FiUploadCloud aria-hidden />} loading={publishing} onClick={onPublish}>
                Nashr etish
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <div role="tabpanel">
        {tab === 'hierarchy' && <HierarchyNav subject={subject} />}
        {tab === 'skills' && <SkillsManager subjectId={subject.id} />}
        {tab === 'assignments' && caps.subjectManage && <AssignmentsManager subjectId={subject.id} />}
      </div>

      <EntityFormDialog
        open={editing}
        title="Fanni tahrirlash"
        fields={[
          { name: 'slug', label: 'Slug', type: 'text', required: true },
          { name: 'title', label: 'Sarlavha', type: 'text', required: true },
          { name: 'description', label: 'Tavsif', type: 'textarea' },
          { name: 'sortOrder', label: 'Tartib', type: 'number' },
        ]}
        initial={{ slug: subject.slug, title: subject.title, description: subject.description ?? '', sortOrder: String(subject.sortOrder) }}
        onSubmit={async (v: FormValues) => {
          await updateSubject(subject.id, {
            expectedUpdatedAt: subject.updatedAt,
            slug: s(v.slug),
            title: s(v.title),
            description: s(v.description) ? s(v.description) : null,
            sortOrder: v.sortOrder ? Number(v.sortOrder) : undefined,
          });
          toast('Saqlandi', 'success');
          res.reload();
        }}
        onClose={() => setEditing(false)}
        onConflictReload={res.reload}
      />
    </div>
  );
}
