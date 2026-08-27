'use client';

import { useEffect, useState } from 'react';
import { FiPlus, FiTrash2 } from 'react-icons/fi';
import {
  createAssessmentItem,
  updateAssessmentItem,
  type AssessmentConfigView,
  type AssessmentItemFormat,
  type AssessmentVersionDetail,
  type StaffAssessmentItem,
} from '@/lib/api/assessments';
import type { Skill } from '@/lib/api/types';
import { useT } from '@/lib/i18n/i18n-context';
import { Button, Field, IconButton, Input, Select, Textarea, useToast } from '@/components/ui';
import { Dialog } from '@/components/ui/dialog';
import { describeError } from '@/lib/ui/error-text';

const OPTION_IDS = 'abcdefghij';
type EditOption = { text: string; correct: boolean };

/**
 * Add/edit a diagnostic question. Objective formats only (single_choice / multiple_choice / true_false). The correct
 * answer IS shown here — this is staff edit mode (the learner preview never receives it). Option ids are reassigned
 * a,b,c… on save (version-scoped items), so the editor only tracks {text, correct}. The server does the authoritative
 * validation; light client checks gate the Save button.
 */
export function AssessmentQuestionEditor({
  open,
  onClose,
  versionId,
  versionUpdatedAt,
  item,
  skills,
  config,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  versionId: string;
  versionUpdatedAt: string;
  item?: StaffAssessmentItem;
  skills: Skill[];
  config: AssessmentConfigView;
  onSaved: (detail: AssessmentVersionDetail) => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const [format, setFormat] = useState<AssessmentItemFormat>('single_choice');
  const [prompt, setPrompt] = useState('');
  const [options, setOptions] = useState<EditOption[]>([{ text: '', correct: false }, { text: '', correct: false }]);
  const [skillId, setSkillId] = useState('');
  const [difficulty, setDifficulty] = useState(config.startDifficulty);
  const [busy, setBusy] = useState(false);

  // Reset when opening (create → defaults; edit → from the item).
  useEffect(() => {
    if (!open) return;
    if (item) {
      setFormat(item.format);
      setPrompt(item.prompt);
      setOptions(item.options.map((o) => ({ text: o.text, correct: item.answerKey.correctOptionIds.includes(o.id) })));
      setSkillId(item.skillId);
      setDifficulty(item.difficulty);
    } else {
      setFormat('single_choice');
      setPrompt('');
      setOptions([{ text: '', correct: false }, { text: '', correct: false }]);
      setSkillId('');
      setDifficulty(config.startDifficulty);
    }
  }, [open, item, config.startDifficulty]);

  const activeSkills = skills.filter((s) => s.status === 'ACTIVE');

  function changeFormat(next: AssessmentItemFormat) {
    setFormat(next);
    if (next === 'true_false') {
      setOptions((prev) => [
        { text: prev[0]?.text || 'True', correct: prev[0]?.correct ?? true },
        { text: prev[1]?.text || 'False', correct: prev[1]?.correct ?? false },
      ]);
    } else if (next === 'single_choice') {
      // collapse to at most one correct
      setOptions((prev) => {
        const firstCorrect = prev.findIndex((o) => o.correct);
        return prev.map((o, i) => ({ ...o, correct: i === firstCorrect }));
      });
    }
  }

  const pickSingle = (idx: number) => setOptions((prev) => prev.map((o, i) => ({ ...o, correct: i === idx })));
  const toggleMultiple = (idx: number) => setOptions((prev) => prev.map((o, i) => (i === idx ? { ...o, correct: !o.correct } : o)));
  const setOptionText = (idx: number, text: string) => setOptions((prev) => prev.map((o, i) => (i === idx ? { ...o, text } : o)));
  const addOption = () => setOptions((prev) => (prev.length < OPTION_IDS.length ? [...prev, { text: '', correct: false }] : prev));
  const removeOption = (idx: number) => setOptions((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== idx) : prev));

  const correctCount = options.filter((o) => o.correct).length;
  const optionCountOk = format === 'true_false' ? options.length === 2 : options.length >= 2;
  const correctOk = format === 'multiple_choice' ? correctCount >= 1 : correctCount === 1;
  const valid =
    prompt.trim().length > 0 &&
    optionCountOk &&
    options.every((o) => o.text.trim().length > 0) &&
    correctOk &&
    skillId !== '' &&
    difficulty >= config.system.minDifficulty &&
    difficulty <= config.system.maxDifficulty;

  async function save() {
    if (!valid) return;
    setBusy(true);
    const body = {
      format,
      prompt: prompt.trim(),
      options: options.map((o, i) => ({ id: OPTION_IDS.charAt(i), text: o.text.trim() })),
      correctOptionIds: options.map((o, i) => ({ correct: o.correct, id: OPTION_IDS.charAt(i) })).filter((x) => x.correct).map((x) => x.id),
      skillId,
      difficulty,
    };
    try {
      const detail = item
        ? await updateAssessmentItem(item.id, { ...body, expectedItemUpdatedAt: item.updatedAt })
        : await createAssessmentItem(versionId, { ...body, expectedVersionUpdatedAt: versionUpdatedAt });
      onSaved(detail);
      toast(t('assessmentBuilder.questionSaved'), 'success');
      onClose();
    } catch (e) {
      toast(describeError(e, t), 'error');
    } finally {
      setBusy(false);
    }
  }

  const isMultiple = format === 'multiple_choice';
  const isTrueFalse = format === 'true_false';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={item ? t('assessmentBuilder.editQuestion') : t('assessmentBuilder.addQuestion')}
      width="max-w-2xl"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button onClick={save} loading={busy} disabled={!valid}>{t('assessmentBuilder.saveQuestion')}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('assessmentBuilder.format')}>
            <Select value={format} disabled={busy} onChange={(e) => changeFormat(e.target.value as AssessmentItemFormat)}>
              <option value="single_choice">{t('assessmentBuilder.formatSingle')}</option>
              <option value="multiple_choice">{t('assessmentBuilder.formatMultiple')}</option>
              <option value="true_false">{t('assessmentBuilder.formatTrueFalse')}</option>
            </Select>
          </Field>
          <Field label={t('assessmentBuilder.difficulty')} hint={`${config.system.minDifficulty}–${config.system.maxDifficulty}`}>
            <Input type="number" min={config.system.minDifficulty} max={config.system.maxDifficulty} value={difficulty} disabled={busy} onChange={(e) => setDifficulty(Number(e.target.value))} />
          </Field>
        </div>

        <Field label={t('assessmentBuilder.skill')}>
          <Select value={skillId} disabled={busy} onChange={(e) => setSkillId(e.target.value)}>
            <option value="">{t('assessmentBuilder.selectSkill')}</option>
            {activeSkills.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>

        <Field label={t('assessmentBuilder.prompt')}>
          <Textarea value={prompt} disabled={busy} onChange={(e) => setPrompt(e.target.value)} rows={2} />
        </Field>

        <div className="space-y-2">
          <p className="text-sm font-medium text-text">{t('assessmentBuilder.options')}</p>
          <p className="text-xs text-muted">{t('assessmentBuilder.answerKeyNote')}</p>
          <ul className="space-y-2">
            {options.map((o, i) => (
              <li key={i} className="flex items-center gap-2">
                <input
                  type={isMultiple ? 'checkbox' : 'radio'}
                  name="assessment-correct"
                  className="h-4 w-4 shrink-0 accent-[rgb(var(--color-primary))]"
                  aria-label={t('assessmentBuilder.correct')}
                  checked={o.correct}
                  disabled={busy}
                  onChange={() => (isMultiple ? toggleMultiple(i) : pickSingle(i))}
                />
                <Input className="flex-1" value={o.text} disabled={busy || isTrueFalse} placeholder={t('assessmentBuilder.options')} onChange={(e) => setOptionText(i, e.target.value)} />
                {!isTrueFalse && options.length > 2 && (
                  <IconButton label={t('assessmentBuilder.removeOption')} variant="ghost" disabled={busy} onClick={() => removeOption(i)}>
                    <FiTrash2 aria-hidden />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
          {!isTrueFalse && options.length < OPTION_IDS.length && (
            <Button size="sm" variant="secondary" leftIcon={<FiPlus aria-hidden />} disabled={busy} onClick={addOption}>
              {t('assessmentBuilder.addOption')}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
