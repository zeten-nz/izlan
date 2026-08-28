import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { StructuredActivityCard } from './StructuredActivityCard';
import type { LearnerActivity } from '@/lib/api/types';

const sentenceOrder: LearnerActivity = { id: 's1', type: 'PRACTICE', position: 1, schemaVersion: 'lesson-activity-structured/v1', format: 'sentence_order', prompt: 'Order the words.', tokens: [{ id: 't1', text: 'She' }, { id: 't2', text: 'works' }, { id: 't3', text: 'here' }] };
const fillBlank: LearnerActivity = { id: 'f1', type: 'PRACTICE', position: 1, schemaVersion: 'lesson-activity-structured/v1', format: 'fill_blank', prompt: 'Fill the blank.', segments: [{ text: 'I have ' }, { blankId: 'b1' }, { text: ' apple.' }], blankIds: ['b1'] };
const controlledText: LearnerActivity = { id: 'c1', type: 'PRACTICE', position: 1, schemaVersion: 'lesson-activity-structured/v1', format: 'controlled_text', prompt: 'Type the plural of box.' };

function renderCard(activity: LearnerActivity, onSubmit: (a: unknown) => void) {
  return render(
    <ThemeProvider><I18nProvider>
      <StructuredActivityCard activity={activity as Parameters<typeof StructuredActivityCard>[0]['activity']} onSubmit={onSubmit} submitLabel="Check" />
    </I18nProvider></ThemeProvider>,
  );
}

describe('StructuredActivityCard (WEB-STRUCT)', () => {
  it('WEB-STRUCT-01 sentence_order: tapping tokens in order builds { orderedTokenIds }', () => {
    const onSubmit = vi.fn();
    renderCard(sentenceOrder, onSubmit);
    // No answer key is ever present in the projected activity.
    expect(document.body.textContent).not.toMatch(/answerKey|correctOrder/);
    fireEvent.click(screen.getByRole('button', { name: 'She' }));
    fireEvent.click(screen.getByRole('button', { name: 'works' }));
    fireEvent.click(screen.getByRole('button', { name: 'here' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(onSubmit).toHaveBeenCalledWith({ orderedTokenIds: ['t1', 't2', 't3'] });
  });

  it('WEB-STRUCT-02 sentence_order: Check is disabled until every token is placed', () => {
    const onSubmit = vi.fn();
    renderCard(sentenceOrder, onSubmit);
    expect(screen.getByRole('button', { name: 'Check' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'She' }));
    expect(screen.getByRole('button', { name: 'Check' })).toBeDisabled(); // 1 of 3
  });

  it('WEB-STRUCT-03 fill_blank: typing each blank builds { blanks }', () => {
    const onSubmit = vi.fn();
    renderCard(fillBlank, onSubmit);
    fireEvent.change(screen.getByLabelText('blank b1'), { target: { value: 'an' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(onSubmit).toHaveBeenCalledWith({ blanks: { b1: 'an' } });
  });

  it('WEB-STRUCT-04 controlled_text: typing builds { text }', () => {
    const onSubmit = vi.fn();
    renderCard(controlledText, onSubmit);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'boxes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(onSubmit).toHaveBeenCalledWith({ text: 'boxes' });
  });
});
