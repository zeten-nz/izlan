'use client';

import { useState } from 'react';
import { FiHelpCircle, FiSend } from 'react-icons/fi';
import { useI18n } from '@/lib/i18n/i18n-context';
import { askAssistant, type AssistantResult, type AssistantTask, type AssistantLanguage } from '@/lib/api/assistant';
import { Button, Card, Textarea } from '@/components/ui';

/**
 * Student Assistant panel — an ADVISORY tutor scoped to the current teaching session. It offers a small, closed set
 * of help actions (never a free-form provider prompt) and shows the server-authored reply. It degrades gracefully:
 * a missing/failing provider returns UNAVAILABLE (a calm note), and nothing here ever blocks or advances learning.
 * `hasRecentMistake` gates the "why was I wrong?" action so no answer is implied before a real incorrect submission.
 */
export function AssistantPanel({ sessionId, hasRecentMistake }: { sessionId: string; hasRecentMistake: boolean }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AssistantResult | null>(null);
  const [question, setQuestion] = useState('');
  const [failed, setFailed] = useState(false);

  const quickTasks: AssistantTask[] = ['EXPLAIN_DIFFERENTLY', 'SIMPLIFY', 'ANOTHER_EXAMPLE', 'HINT'];

  async function run(task: AssistantTask, q?: string) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await askAssistant(sessionId, { task, question: q, language: locale as AssistantLanguage });
      setResult(res);
    } catch {
      // The endpoint is designed never to 5xx; a transport failure still must not break the lesson — degrade calmly.
      setFailed(true);
      setResult({ status: 'UNAVAILABLE', message: null });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex justify-center">
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <FiHelpCircle aria-hidden /> {t('learner.assistant.open')}
        </Button>
      </div>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-text"><FiHelpCircle className="text-primary" aria-hidden /> {t('learner.assistant.title')}</span>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>{t('common.close')}</Button>
      </div>
      <p className="text-xs text-muted">{t('learner.assistant.subtitle')}</p>

      <div className="flex flex-wrap gap-2">
        {quickTasks.map((task) => (
          <Button key={task} variant="secondary" size="sm" onClick={() => run(task)} disabled={busy}>
            {t(`learner.assistant.task.${taskKey(task)}`)}
          </Button>
        ))}
        {hasRecentMistake && (
          <Button variant="secondary" size="sm" onClick={() => run('WHY_WRONG')} disabled={busy}>
            {t('learner.assistant.task.whyWrong')}
          </Button>
        )}
      </div>

      <form
        className="flex items-start gap-2"
        onSubmit={(e) => { e.preventDefault(); const q = question.trim(); if (q) run('QUESTION', q); }}
      >
        <Textarea
          rows={2}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t('learner.assistant.questionPlaceholder')}
          aria-label={t('learner.assistant.questionPlaceholder')}
          className="flex-1"
          maxLength={500}
        />
        <Button type="submit" size="sm" loading={busy} disabled={busy || question.trim().length === 0} aria-label={t('learner.assistant.send')}>
          <FiSend aria-hidden />
        </Button>
      </form>

      <div aria-live="polite" className="min-h-[1.5rem]">
        {result && <AssistantReply result={result} failed={failed} />}
      </div>
    </Card>
  );
}

function AssistantReply({ result, failed }: { result: AssistantResult; failed: boolean }) {
  const { t } = useI18n();
  if (result.status === 'ANSWERED' && result.message) {
    return <div className="whitespace-pre-wrap rounded-control border border-border bg-surface-2 p-3 text-sm text-text">{result.message}</div>;
  }
  if (result.status === 'DECLINED') {
    return <p className="text-sm text-muted">{t('learner.assistant.declined')}</p>;
  }
  // UNAVAILABLE (no provider configured, provider failed, or a transport error) — a calm, honest state.
  return <p className="text-sm text-muted">{t(failed ? 'learner.assistant.error' : 'learner.assistant.unavailable')}</p>;
}

/** Map the closed task enum to its i18n leaf key (camelCase). */
function taskKey(task: AssistantTask): string {
  switch (task) {
    case 'EXPLAIN_DIFFERENTLY': return 'explain';
    case 'ANOTHER_EXAMPLE': return 'example';
    case 'SIMPLIFY': return 'simplify';
    case 'HINT': return 'hint';
    case 'WHY_WRONG': return 'whyWrong';
    case 'QUESTION': return 'question';
  }
}
