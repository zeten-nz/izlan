'use client';

import { useCallback, useState } from 'react';
import { FiSend, FiUploadCloud, FiCornerUpLeft, FiCheckCircle } from 'react-icons/fi';
import { getLesson, getReadiness, publishRevision, returnToDraft, submitReview } from '@/lib/api/content';
import { useResource } from '@/lib/hooks/use-resource';
import { useRevisionEditor } from '@/lib/cms/revision-editor-context';
import { useCapabilities } from '@/lib/cms/cms-context';
import { Button, useToast } from '@/components/ui';
import { ConfirmDialog } from '@/components/ui/dialog';
import { describeError } from '@/lib/ui/error-text';

export function WorkflowActions({ onReload }: { onReload?: () => void }) {
  const { revision, setRevision } = useRevisionEditor();
  const caps = useCapabilities();
  const { toast } = useToast();
  const lessonRes = useResource(useCallback(() => getLesson(revision.lessonId), [revision.lessonId]), [revision.lessonId, revision.updatedAt]);
  const [busy, setBusy] = useState(false);
  const [returning, setReturning] = useState(false);
  const [publishConfirm, setPublishConfirm] = useState(false);
  const [freshLessonToken, setFreshLessonToken] = useState<string | null>(null);

  const status = revision.status;
  const isCurrent = lessonRes.data?.publishedRevisionId === revision.id && status === 'PUBLISHED';

  async function onSubmit() {
    setBusy(true);
    try {
      const readiness = await getReadiness(revision.id); // §38 refresh before transition
      if (!readiness.reviewReady) {
        toast('Ko‘rikka tayyor emas — «Tayyorlik» panelidagi bloklovchilarni bartaraf eting.', 'error');
        return;
      }
      const updated = await submitReview(revision.id, { expectedUpdatedAt: revision.updatedAt });
      setRevision(updated);
      toast('Ko‘rikka yuborildi', 'success');
    } catch (e) {
      toast(describeError(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function beginPublish() {
    setBusy(true);
    try {
      const readiness = await getReadiness(revision.id); // §40 refresh readiness
      if (!readiness.publishReady) {
        toast('Nashrga tayyor emas — bloklovchilarni bartaraf eting.', 'error');
        return;
      }
      const freshLesson = await getLesson(revision.lessonId); // §40 fresh Lesson token
      setFreshLessonToken(freshLesson.updatedAt);
      setPublishConfirm(true);
    } catch (e) {
      toast(describeError(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function confirmPublish() {
    if (!freshLessonToken) return;
    setBusy(true);
    try {
      const view = await publishRevision(revision.id, { expectedRevisionUpdatedAt: revision.updatedAt, expectedLessonUpdatedAt: freshLessonToken });
      setRevision(view.revision);
      toast('Nashr etildi', 'success');
      lessonRes.reload();
      onReload?.();
    } catch (e) {
      toast(describeError(e), 'error');
    } finally {
      setBusy(false);
      setPublishConfirm(false);
      setFreshLessonToken(null);
    }
  }

  async function onReturn(reason: string) {
    setBusy(true);
    try {
      const updated = await returnToDraft(revision.id, { expectedUpdatedAt: revision.updatedAt, reason });
      setRevision(updated);
      toast('Qoralamaga qaytarildi', 'success');
    } catch (e) {
      toast(describeError(e), 'error');
    } finally {
      setBusy(false);
      setReturning(false);
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-text">Ish jarayoni</h3>

      {status === 'DRAFT' && caps.author && (
        <Button className="w-full" leftIcon={<FiSend aria-hidden />} loading={busy} onClick={onSubmit}>
          Ko‘rikka yuborish
        </Button>
      )}

      {status === 'REVIEW' && caps.publish && (
        <div className="space-y-2">
          <Button className="w-full" leftIcon={<FiUploadCloud aria-hidden />} loading={busy} onClick={beginPublish}>
            Nashr etish
          </Button>
          <Button className="w-full" variant="secondary" leftIcon={<FiCornerUpLeft aria-hidden />} disabled={busy} onClick={() => setReturning(true)}>
            Qoralamaga qaytarish
          </Button>
        </div>
      )}
      {status === 'REVIEW' && !caps.publish && <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted">Ko‘rikda — nashr etish huquqi yo‘q.</p>}

      {status === 'PUBLISHED' &&
        (isCurrent ? (
          <p className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
            <FiCheckCircle aria-hidden /> Joriy nashr etilgan versiya
          </p>
        ) : (
          <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted">Nashr etilgan (joriy emas — tarixiy).</p>
        ))}

      {status === 'ARCHIVED' && <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted">Arxivlangan (tarixiy, faqat o‘qish).</p>}

      <ConfirmDialog
        open={publishConfirm}
        onClose={() => {
          setPublishConfirm(false);
          setFreshLessonToken(null);
        }}
        onConfirm={confirmPublish}
        title="Versiyani nashr etish"
        message={
          <span>
            Dars: <strong>{lessonRes.data?.contentKey ?? '—'}</strong>
            <br />
            Versiya: <strong>v{revision.version}</strong>
            <br />
            Tayyorlik: <strong>nashrga tayyor</strong>. Nashr etilsinmi?
          </span>
        }
        confirmLabel="Nashr etish"
        busy={busy}
      />

      <ConfirmDialog
        open={returning}
        onClose={() => setReturning(false)}
        onConfirm={onReturn}
        title="Qoralamaga qaytarish"
        message="Bu versiyani qoralama holatiga qaytaradi. Sabab majburiy."
        confirmLabel="Qaytarish"
        requireReason
        reasonLabel="Sabab"
        busy={busy}
      />
    </div>
  );
}
