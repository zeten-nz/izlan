'use client';

import { useCallback, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { FiArchive, FiEdit2, FiMove } from 'react-icons/fi';
import { addLessonSkill, addPrerequisite, archiveLesson, getLesson, listLessonSkills, moveLesson, removeLessonSkill, removePrerequisite, updateLesson } from '@/lib/api/content';
import { resolveLessonSubjectId } from '@/lib/api/hierarchy-helpers';
import type { Lesson } from '@/lib/api/types';
import { useResource } from '@/lib/hooks/use-resource';
import { useCapabilities } from '@/lib/cms/cms-context';
import { useT } from '@/lib/i18n/i18n-context';
import { Button, Card, useToast } from '@/components/ui';
import { StatusBadge, Badge } from '@/components/ui/status-badge';
import { ConfirmDialog } from '@/components/ui/dialog';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { EntityFormDialog, type FormValues } from '@/components/forms/EntityFormDialog';
import { RevisionsPanel } from '@/components/lesson/RevisionsPanel';
import { PrerequisitesPanel } from '@/components/lesson/PrerequisitesPanel';
import { MappedSkillsPanel } from '@/components/skills/MappedSkillsPanel';
import { describeError } from '@/lib/ui/error-text';
import { formatDateTime } from '@/lib/ui/format';
import { fadeInUp } from '@/lib/motion/motion';

const s = (v?: string) => (v ?? '').trim();

export default function LessonWorkspace() {
  const params = useParams<{ lessonId: string }>();
  const lessonId = params.lessonId;
  const caps = useCapabilities();
  const t = useT();
  const { toast } = useToast();
  const res = useResource(useCallback(() => getLesson(lessonId), [lessonId]), [lessonId]);
  const lessonRef = useRef<Lesson | null>(null);
  lessonRef.current = res.data;

  // Resolve the owning Subject once per lesson (keyed on the stable topicId, not on res.data identity).
  const subjectRes = useResource(
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useCallback(() => (res.data ? resolveLessonSubjectId(res.data) : Promise.reject(new Error('no lesson'))), [res.data?.topicId]),
    [res.data?.topicId],
  );

  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [tokenTick, setTokenTick] = useState(0); // forces skill/prereq panels to refetch after token advance

  if (res.loading && !res.data) return <LoadingRows rows={4} />;
  if (res.error && !res.data) return <ErrorState error={res.error} onRetry={res.reload} />;
  const lesson = res.data;
  if (!lesson) return <ErrorState error={res.error} onRetry={res.reload} />;

  const isDraft = lesson.status === 'DRAFT';
  const editable = caps.author && isDraft;
  const subjectId = subjectRes.data ?? '';

  // ONE Lesson.updatedAt aggregate token authority for LessonSkill + Prerequisite mutations.
  const setLessonToken = (updatedAt: string) => {
    res.setData((prev) => (prev ? { ...prev, updatedAt } : prev));
    setTokenTick((n) => n + 1);
  };
  const currentUpdatedAt = lesson.updatedAt;
  const token = () => lessonRef.current?.updatedAt ?? currentUpdatedAt;

  async function onArchive(reason: string) {
    setArchiveBusy(true);
    try {
      await archiveLesson(lessonId, { expectedLessonUpdatedAt: token(), reason });
      toast(t('lesson.archivedToast'), 'success');
      res.reload();
    } catch (e) {
      toast(describeError(e, t), 'error');
      res.reload();
    } finally {
      setArchiveBusy(false);
      setArchiving(false);
    }
  }

  return (
    <motion.div variants={fadeInUp} initial="initial" animate="animate" className="mx-auto max-w-5xl space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-xl font-bold text-text">{lesson.contentKey}</h1>
              <StatusBadge status={lesson.status} />
              {lesson.publishedRevisionId && <Badge tone="success">{t('lesson.currentPublication')}</Badge>}
            </div>
            <p className="text-sm text-muted">
              {lesson.slug ? `/${lesson.slug}` : t('hierarchy.noSlug')} · {t('hierarchy.metaOrder', { n: lesson.sortOrder })}
            </p>
            <p className="mt-1 text-xs text-muted">
              {t('common.updatedAt')}: {formatDateTime(lesson.updatedAt)}
            </p>
            {lesson.status === 'ARCHIVED' && <p className="mt-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">{t('lesson.archivedNotice')}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {editable && (
              <>
                <Button variant="secondary" size="sm" leftIcon={<FiEdit2 aria-hidden />} onClick={() => setEditing(true)}>
                  {t('common.edit')}
                </Button>
                <Button variant="secondary" size="sm" leftIcon={<FiMove aria-hidden />} onClick={() => setMoving(true)}>
                  {t('lesson.move')}
                </Button>
              </>
            )}
            {caps.publish && lesson.status === 'PUBLISHED' && (
              <Button variant="danger" size="sm" leftIcon={<FiArchive aria-hidden />} onClick={() => setArchiving(true)}>
                {t('lesson.takedown')}
              </Button>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RevisionsPanel lessonId={lessonId} publishedRevisionId={lesson.publishedRevisionId} canAuthor={caps.author} />
        </div>
        <div className="space-y-5">
          <Card className="p-4">
            {subjectId ? (
              <MappedSkillsPanel
                label={t('lesson.skillsLabel')}
                subjectId={subjectId}
                editable={editable}
                reloadKey={`ls:${lessonId}:${tokenTick}`}
                loadMapped={() => listLessonSkills(lessonId)}
                onAdd={async (skillId) => {
                  const r = await addLessonSkill(lessonId, { expectedLessonUpdatedAt: token(), skillId });
                  setLessonToken(r.lessonUpdatedAt);
                }}
                onRemove={async (skillId) => {
                  const r = await removeLessonSkill(lessonId, skillId, { expectedLessonUpdatedAt: token() });
                  setLessonToken(r.lessonUpdatedAt);
                }}
              />
            ) : (
              <p className="text-xs text-muted">{t('lesson.subjectResolving')}</p>
            )}
          </Card>
          <Card className="p-4">
            {subjectId && (
              <PrerequisitesPanel
                lessonId={lessonId}
                subjectId={subjectId}
                editable={editable}
                reloadKey={`pr:${lessonId}:${tokenTick}`}
                onAdd={async (prereqId) => {
                  const r = await addPrerequisite(lessonId, { expectedLessonUpdatedAt: token(), prerequisiteLessonId: prereqId });
                  setLessonToken(r.lessonUpdatedAt);
                }}
                onRemove={async (prereqId) => {
                  const r = await removePrerequisite(lessonId, prereqId, { expectedLessonUpdatedAt: token() });
                  setLessonToken(r.lessonUpdatedAt);
                }}
              />
            )}
          </Card>
        </div>
      </div>

      <EntityFormDialog
        open={editing}
        title={t('lesson.editTitle')}
        fields={[
          { name: 'slug', label: t('subjects.slug'), type: 'text', hint: t('lesson.slugHint') },
          { name: 'sortOrder', label: t('common.order'), type: 'number' },
        ]}
        initial={{ slug: lesson.slug ?? '', sortOrder: String(lesson.sortOrder) }}
        onSubmit={async (v: FormValues) => {
          await updateLesson(lessonId, { expectedUpdatedAt: token(), slug: s(v.slug) ? s(v.slug) : null, sortOrder: v.sortOrder ? Number(v.sortOrder) : undefined });
          toast(t('common.saved'), 'success');
          res.reload();
        }}
        onClose={() => setEditing(false)}
        onConflictReload={res.reload}
      />

      <EntityFormDialog
        open={moving}
        title={t('lesson.moveTitle')}
        fields={[{ name: 'toTopicId', label: t('lesson.moveField'), type: 'text', required: true }]}
        onSubmit={async (v: FormValues) => {
          await moveLesson(lessonId, { expectedUpdatedAt: token(), toTopicId: s(v.toTopicId) });
          toast(t('lesson.moved'), 'success');
          res.reload();
        }}
        onClose={() => setMoving(false)}
        onConflictReload={res.reload}
      />

      <ConfirmDialog
        open={archiving}
        onClose={() => setArchiving(false)}
        onConfirm={onArchive}
        title={t('lesson.takedownTitle')}
        message={t('lesson.takedownBody')}
        confirmLabel={t('lesson.takedown')}
        danger
        requireReason
        reasonLabel={t('common.reason')}
        busy={archiveBusy}
      />
    </motion.div>
  );
}
