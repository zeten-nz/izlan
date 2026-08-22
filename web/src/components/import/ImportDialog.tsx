'use client';

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { FiAlertCircle, FiCheckCircle, FiFileText, FiUploadCloud, FiXCircle } from 'react-icons/fi';
import { applyImport, validateImport } from '@/lib/api/content';
import type { ImportApplyResponse, ImportIssue, ImportSummary, ImportValidateResponse } from '@/lib/api/types';
import { useT } from '@/lib/i18n/i18n-context';
import { describeError } from '@/lib/ui/error-text';
import { ApiError } from '@/lib/api/errors';
import { Dialog } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui';
import { Badge } from '@/components/ui/status-badge';

const MAX_BYTES = 5 * 1024 * 1024;

function SummaryGrid({ summary }: { summary: ImportSummary }) {
  const t = useT();
  const cells: [string, number][] = [
    [t('import.skills'), summary.skillsToCreate + summary.skillsReused],
    [t('import.lessons'), summary.lessonsToCreate],
    [t('import.activities'), summary.activitiesToCreate],
    [t('import.mappings'), summary.lessonSkillMappings + summary.activitySkillMappings],
    [t('import.prerequisites'), summary.prerequisitesToCreate],
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {cells.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-center">
          <div className="text-lg font-bold text-text">{value}</div>
          <div className="text-[11px] text-muted">{label}</div>
        </div>
      ))}
    </div>
  );
}

/** Topic-scoped bulk import: file → dry-run (validate) → confirm → atomic apply. The parsed document lives only in
 *  component memory — it is NEVER written to localStorage/sessionStorage/IndexedDB (authoring JSON may hold answer keys). */
export function ImportDialog({ topicId, open, onClose, onImported }: { topicId: string; open: boolean; onClose: () => void; onImported: () => void }) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [doc, setDoc] = useState<unknown>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [validation, setValidation] = useState<ImportValidateResponse | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<ImportApplyResponse | null>(null);

  const resetState = useCallback(() => {
    setFileName(null);
    setDoc(null);
    setFileError(null);
    setValidation(null);
    setActionError(null);
    setResult(null);
  }, []);

  const readFile = useCallback(
    (file: File) => {
      resetState();
      if (!file.name.toLowerCase().endsWith('.json')) return void setFileError(t('import.onlyJson'));
      if (file.size > MAX_BYTES) return void setFileError(t('import.tooLarge'));
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed: unknown = JSON.parse(String(reader.result)); // safe parse only — never eval / render as HTML
          setDoc(parsed);
          setFileName(file.name);
        } catch {
          setFileError(t('import.invalidJson'));
        }
      };
      reader.onerror = () => setFileError(t('import.invalidJson'));
      reader.readAsText(file);
    },
    [resetState, t],
  );

  async function onValidate() {
    if (doc == null) return;
    setBusy(true);
    setActionError(null);
    setResult(null);
    try {
      setValidation(await validateImport(topicId, doc));
    } catch (e) {
      setActionError(errorText(e)); // hard schema/limit → 400 with an import code
      setValidation(null);
    } finally {
      setBusy(false);
    }
  }

  async function onApply() {
    if (doc == null) return;
    setBusy(true);
    setActionError(null);
    try {
      const r = await applyImport(topicId, doc); // server re-validates authoritatively — the dry-run is not trusted
      setResult(r);
      onImported();
    } catch (e) {
      setActionError(errorText(e));
      setValidation(null); // force a re-check on any apply-time conflict
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  const codeMessage = (code: string): string | null => {
    const key = `import.codes.${code}`;
    const msg = t(key);
    return msg === key ? null : msg;
  };
  const issueText = (i: ImportIssue) => codeMessage(i.code) ?? t('import.unknownCode', { code: i.code });
  // Prefer import-specific copy for IMPORT_* codes; fall back to the shared error mapper (auth/network).
  const errorText = (e: unknown) => (e instanceof ApiError ? codeMessage(e.code) : null) ?? describeError(e, t);

  function close() {
    resetState();
    onClose();
  }

  return (
    <>
      <Dialog open={open} onClose={close} title={t('import.title')} width="max-w-2xl">
        {result ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-success">
              <FiCheckCircle aria-hidden />
              <span className="font-medium">{t('import.successTitle')}</span>
            </div>
            <SummaryGrid summary={result.summary} />
            <ul className="izl-scroll max-h-56 space-y-1 overflow-y-auto">
              {result.lessons.map((l) => (
                <li key={l.lessonId} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-mono text-xs text-text">{l.contentKey}</span>
                    <Badge tone="muted">{t('import.draftBadge')}</Badge>
                  </span>
                  <Link href={`/staff/content/lessons/${l.lessonId}`} onClick={close} className="text-xs text-primary hover:underline">
                    {t('import.openLesson')}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <Button onClick={close}>{t('import.back')}</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted">{t('import.subtitle')}</p>

            {/* File picker + drag & drop */}
            {fileName ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm">
                <span className="flex items-center gap-2 truncate text-text">
                  <FiFileText aria-hidden /> {fileName}
                </span>
                <Button size="sm" variant="ghost" onClick={resetState}>
                  {t('import.clear')}
                </Button>
              </div>
            ) : (
              <div
                role="button"
                tabIndex={0}
                onClick={() => inputRef.current?.click()}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) readFile(f);
                }}
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border border-dashed border-border bg-surface-2 px-6 py-10 text-center text-sm text-muted transition-colors hover:border-primary/60"
              >
                <FiUploadCloud className="text-2xl" aria-hidden />
                <span>{t('import.dropHint')}</span>
                <span className="text-xs">{t('import.pick')}</span>
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="application/json,.json"
              aria-label={t('import.pick')}
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) readFile(f);
                e.target.value = '';
              }}
            />
            {fileError && <p className="text-sm text-danger">{fileError}</p>}
            {actionError && (
              <p className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
                <FiAlertCircle aria-hidden /> {actionError}
              </p>
            )}

            {/* Dry-run report */}
            {validation && (
              <div className="space-y-3">
                <div className={`flex items-center gap-2 text-sm font-medium ${validation.valid ? 'text-success' : 'text-danger'}`}>
                  {validation.valid ? <FiCheckCircle aria-hidden /> : <FiXCircle aria-hidden />}
                  {validation.valid ? t('import.valid') : t('import.invalid')}
                </div>
                <SummaryGrid summary={validation.summary} />
                {validation.errors.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-danger">{t('import.errorsTitle')}</p>
                    <ul className="izl-scroll max-h-48 space-y-1 overflow-y-auto">
                      {validation.errors.map((e, i) => (
                        <li key={`${e.code}-${i}`} className="flex items-start gap-2 text-sm">
                          <FiXCircle className="mt-0.5 shrink-0 text-danger" aria-hidden />
                          <span>
                            <span className="text-text">{issueText(e)}</span>
                            <span className="ml-1 font-mono text-[11px] text-muted">{e.path}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {validation.documentHash && <p className="font-mono text-[11px] text-muted">{t('import.hash')}: {validation.documentHash.slice(0, 12)}…</p>}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onValidate} loading={busy && !confirm} disabled={doc == null || busy}>
                {busy && !confirm ? t('import.validating') : t('import.validate')}
              </Button>
              <Button onClick={() => setConfirm(true)} disabled={!validation?.valid || busy}>
                {t('import.apply')}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={onApply}
        title={t('import.confirmTitle')}
        message={
          <span className="block space-y-1">
            <span className="block">{t('import.confirmBody', { n: validation?.summary.lessonsToCreate ?? 0 })}</span>
            <span className="block text-warning">{t('import.confirmNote')}</span>
          </span>
        }
        confirmLabel={t('import.apply')}
        busy={busy}
      />
    </>
  );
}
