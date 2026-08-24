'use client';

import { FiCheckCircle, FiXCircle } from 'react-icons/fi';
import { useT } from '@/lib/i18n/i18n-context';

/**
 * Backend-authoritative correctness feedback, shared by Lesson + Review runners. Icon + text (never colour alone).
 * The backend returns `isCorrect` only — no explanation and no correct-answer reveal, so none is shown.
 */
export function FeedbackBanner({ isCorrect }: { isCorrect: boolean }) {
  const t = useT();
  return (
    <div
      role="status"
      className={`flex items-center gap-2.5 rounded-panel border p-4 ${isCorrect ? 'border-success/40 bg-success/5 text-success' : 'border-danger/40 bg-danger/5 text-danger'}`}
    >
      {isCorrect ? <FiCheckCircle aria-hidden className="text-xl" /> : <FiXCircle aria-hidden className="text-xl" />}
      <span className="font-semibold">{isCorrect ? t('learner.lesson.correct') : t('learner.lesson.incorrect')}</span>
    </div>
  );
}
