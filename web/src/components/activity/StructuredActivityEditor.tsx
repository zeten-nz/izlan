'use client';

import { useT } from '@/lib/i18n/i18n-context';
import { Field, Input, Textarea } from '@/components/ui';
import type { StructuredDraft } from '@/lib/activity/structured-serializer';

/**
 * Structured-production authoring sub-form (no raw JSON). The parent ObjectiveActivityEditor owns the format selector
 * + save; this renders the per-format inputs and the shared normalization + remediation controls. The correct order /
 * accepted answers authored here are the SERVER-ONLY answer key (never shown in the learner preview).
 */
export function StructuredActivityEditor({ draft, setDraft }: { draft: StructuredDraft; setDraft: (u: (d: StructuredDraft) => StructuredDraft) => void }) {
  const t = useT();
  const set = <K extends keyof StructuredDraft>(k: K, v: StructuredDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className="space-y-3">
      <Field label={t('activity.prompt')} htmlFor="st-prompt">
        <Textarea id="st-prompt" rows={2} value={draft.prompt} onChange={(e) => set('prompt', e.target.value)} />
      </Field>

      {draft.format === 'sentence_order' && (
        <Field label={t('activity.structured.sentenceLabel')} htmlFor="st-sentence" hint={t('activity.structured.sentenceHint')}>
          <Input id="st-sentence" value={draft.sentence} onChange={(e) => set('sentence', e.target.value)} placeholder="She works here" />
        </Field>
      )}

      {draft.format === 'fill_blank' && (
        <Field label={t('activity.structured.templateLabel')} htmlFor="st-template" hint={t('activity.structured.templateHint')}>
          <Textarea id="st-template" rows={2} value={draft.template} onChange={(e) => set('template', e.target.value)} placeholder="I have {an} apple." />
        </Field>
      )}

      {draft.format === 'controlled_text' && (
        <Field label={t('activity.structured.acceptedLabel')} htmlFor="st-accepted" hint={t('activity.structured.acceptedHint')}>
          <Textarea id="st-accepted" rows={3} value={draft.accepted} onChange={(e) => set('accepted', e.target.value)} placeholder={'boxes'} />
        </Field>
      )}

      {(draft.format === 'fill_blank' || draft.format === 'controlled_text') && (
        <fieldset className="rounded-control border border-border p-3">
          <legend className="px-1 text-xs font-semibold text-muted">{t('activity.structured.normalization')}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
            <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={draft.caseFold} onChange={(e) => set('caseFold', e.target.checked)} /> {t('activity.structured.caseFold')}</label>
            <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={draft.collapseWhitespace} onChange={(e) => set('collapseWhitespace', e.target.checked)} /> {t('activity.structured.collapseWs')}</label>
            <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={draft.stripPunctuation} onChange={(e) => set('stripPunctuation', e.target.checked)} /> {t('activity.structured.stripPunct')}</label>
          </div>
        </fieldset>
      )}

      <Field label={t('activity.structured.remediationLabel')} htmlFor="st-rem" hint={t('activity.structured.remediationHint')}>
        <Textarea id="st-rem" rows={2} value={draft.remediation} onChange={(e) => set('remediation', e.target.value)} />
      </Field>
    </div>
  );
}
