'use client';

import { FiChevronUp, FiChevronDown, FiEdit2, FiPlus, FiTrash2 } from 'react-icons/fi';
import type { StaffAssessmentItem } from '@/lib/api/assessments';
import type { Skill } from '@/lib/api/types';
import { useT } from '@/lib/i18n/i18n-context';
import { Badge, Button, Card, IconButton } from '@/components/ui';

const FORMAT_KEY: Record<string, string> = { single_choice: 'formatSingle', multiple_choice: 'formatMultiple', true_false: 'formatTrueFalse' };

/** Ordered question list. Reorder / edit / delete only when the owning version is an editable DRAFT (staff mode). */
export function AssessmentQuestionList({
  items,
  skills,
  editable,
  onAdd,
  onEdit,
  onDelete,
  onMove,
}: {
  items: StaffAssessmentItem[];
  skills: Skill[];
  editable: boolean;
  onAdd: () => void;
  onEdit: (item: StaffAssessmentItem) => void;
  onDelete: (item: StaffAssessmentItem) => void;
  onMove: (index: number, dir: -1 | 1) => void;
}) {
  const t = useT();
  const skillName = (id: string) => skills.find((s) => s.id === id)?.name ?? id;

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">{t('assessmentBuilder.questionsTitle')}</h3>
        {editable && (
          <Button size="sm" leftIcon={<FiPlus aria-hidden />} onClick={onAdd}>{t('assessmentBuilder.addQuestion')}</Button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted">{t('assessmentBuilder.noQuestions')}</p>
      ) : (
        <ol className="space-y-2">
          {items.map((item, idx) => (
            <li key={item.id} className="flex items-start gap-3 rounded-control border border-border bg-surface px-3 py-2">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-2 text-xs text-muted">{idx + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text">{item.prompt}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <Badge tone="muted">{t(`assessmentBuilder.${FORMAT_KEY[item.format]}`)}</Badge>
                  <span className="truncate">{skillName(item.skillId)}</span>
                  <span>· {t('assessmentBuilder.difficulty')} {item.difficulty}</span>
                </div>
              </div>
              {editable && (
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton label={t('assessmentBuilder.moveUp')} variant="ghost" disabled={idx === 0} onClick={() => onMove(idx, -1)}><FiChevronUp aria-hidden /></IconButton>
                  <IconButton label={t('assessmentBuilder.moveDown')} variant="ghost" disabled={idx === items.length - 1} onClick={() => onMove(idx, 1)}><FiChevronDown aria-hidden /></IconButton>
                  <IconButton label={t('assessmentBuilder.editQuestion')} variant="ghost" onClick={() => onEdit(item)}><FiEdit2 aria-hidden /></IconButton>
                  <IconButton label={t('assessmentBuilder.deleteQuestion')} variant="danger" onClick={() => onDelete(item)}><FiTrash2 aria-hidden /></IconButton>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
