import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { ListeningActivityCard } from './ListeningActivityCard';
import type { LearnerActivity } from '@/lib/api/types';

// The audio bytes are fetched through the AUTHENTICATED media transport — mock it so no real network is hit.
vi.mock('@/lib/api/media', () => ({ fetchMediaObjectUrl: vi.fn(() => Promise.resolve('blob:audio-1')) }));
import { fetchMediaObjectUrl } from '@/lib/api/media';

const listening: LearnerActivity = {
  id: 'l1', type: 'PRACTICE', position: 1, schemaVersion: 'lesson-activity-listening/v1', format: 'listening_comprehension',
  prompt: 'What does the speaker order?',
  options: [{ id: 'o1', text: 'A coffee' }, { id: 'o2', text: 'A tea' }],
  media: [{ id: 'aud-1', kind: 'audio', mimeType: 'audio/wav', altText: null }],
};

function renderCard(activity: LearnerActivity, onSubmit: (a: unknown) => void) {
  return render(
    <ThemeProvider><I18nProvider>
      <ListeningActivityCard activity={activity as Parameters<typeof ListeningActivityCard>[0]['activity']} onSubmit={onSubmit} submitLabel="Check" />
    </I18nProvider></ThemeProvider>,
  );
}

describe('ListeningActivityCard (WEB-LISTEN)', () => {
  beforeEach(() => {
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn();
  });

  it('WEB-LISTEN-01 fetches the attached audio via the authenticated transport and renders a native <audio> player', async () => {
    renderCard(listening, vi.fn());
    await waitFor(() => expect(fetchMediaObjectUrl).toHaveBeenCalledWith('aud-1'));
    const audio = await screen.findByLabelText('Audio'); // audioLabel fallback aria-label
    expect(audio.tagName.toLowerCase()).toBe('audio');
    expect(audio).toHaveAttribute('src', 'blob:audio-1');
    // No answer key or transcript is ever present in the projected activity.
    expect(document.body.textContent).not.toMatch(/answerKey|correctOptionIds|transcript/);
  });

  it('WEB-LISTEN-02 selecting an option and checking submits the single_choice answer shape', () => {
    const onSubmit = vi.fn();
    renderCard(listening, onSubmit);
    fireEvent.click(screen.getByText('A coffee'));
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(onSubmit).toHaveBeenCalledWith({ selectedOptionId: 'o1' });
  });
});
