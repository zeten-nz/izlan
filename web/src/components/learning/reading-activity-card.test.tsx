import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { ReadingActivityCard } from './ReadingActivityCard';
import type { LearnerActivity } from '@/lib/api/types';

const reading: LearnerActivity = {
  id: 'r1', type: 'MASTERY_TEST', position: 1, schemaVersion: 'lesson-activity-reading/v1', format: 'reading_comprehension',
  passage: 'My name is Aziz. I am a doctor. I work in a hospital in Tashkent.',
  prompt: "What is Aziz's job?",
  options: [{ id: 'o1', text: 'A teacher' }, { id: 'o2', text: 'A doctor' }],
};

function renderCard(activity: LearnerActivity, onSubmit: (a: unknown) => void) {
  return render(
    <ThemeProvider><I18nProvider>
      <ReadingActivityCard activity={activity as Parameters<typeof ReadingActivityCard>[0]['activity']} onSubmit={onSubmit} submitLabel="Check" />
    </I18nProvider></ThemeProvider>,
  );
}

describe('ReadingActivityCard (WEB-READ)', () => {
  it('WEB-READ-01 renders the visible passage (the stimulus) and the comprehension question, with no answer key', () => {
    renderCard(reading, vi.fn());
    expect(screen.getByText(/I am a doctor/)).toBeInTheDocument(); // passage is shown — it must be read
    expect(screen.getByText("What is Aziz's job?")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/answerKey|correctOptionIds/);
  });

  it('WEB-READ-02 selecting an option and checking submits the single_choice answer shape', () => {
    const onSubmit = vi.fn();
    renderCard(reading, onSubmit);
    fireEvent.click(screen.getByText('A doctor'));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(onSubmit).toHaveBeenCalledWith({ selectedOptionId: 'o2' });
  });
});
