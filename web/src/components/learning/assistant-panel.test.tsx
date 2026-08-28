import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { AssistantPanel } from './AssistantPanel';

const h = vi.hoisted(() => ({ ask: vi.fn() }));
vi.mock('@/lib/api/assistant', () => ({ askAssistant: h.ask }));

function renderPanel(hasRecentMistake = false) {
  return render(
    <ThemeProvider><I18nProvider><AssistantPanel sessionId="sess1" hasRecentMistake={hasRecentMistake} /></I18nProvider></ThemeProvider>,
  );
}

describe('AssistantPanel (WEB-AS)', () => {
  beforeEach(() => { h.ask.mockReset(); });

  it('WEB-AS-01 is collapsed by default and does not call the assistant on render', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: /Yordam kerakmi\?/ })).toBeInTheDocument();
    expect(h.ask).not.toHaveBeenCalled();
  });

  it('WEB-AS-02 a quick action asks the assistant and renders the ANSWERED reply (never an answer key)', async () => {
    h.ask.mockResolvedValue({ status: 'ANSWERED', message: 'Think about habits vs. facts.' });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Yordam kerakmi\?/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ishora' }));
    await waitFor(() => expect(h.ask).toHaveBeenCalledWith('sess1', expect.objectContaining({ task: 'HINT' })));
    expect(await screen.findByText('Think about habits vs. facts.')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('answerKey');
  });

  it('WEB-AS-03 an UNAVAILABLE provider degrades to a calm note (never blocks learning)', async () => {
    h.ask.mockResolvedValue({ status: 'UNAVAILABLE', message: null });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Yordam kerakmi\?/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Soddaroq' }));
    expect(await screen.findByText(/hozircha mavjud emas/)).toBeInTheDocument();
  });

  it('WEB-AS-04 "Why was I wrong?" appears only after a real mistake; DECLINED shows a gentle nudge', async () => {
    h.ask.mockResolvedValue({ status: 'DECLINED', message: null });
    const { rerender } = renderPanel(false);
    fireEvent.click(screen.getByRole('button', { name: /Yordam kerakmi\?/ }));
    expect(screen.queryByRole('button', { name: 'Nega xato qildim?' })).not.toBeInTheDocument();

    rerender(<ThemeProvider><I18nProvider><AssistantPanel sessionId="sess1" hasRecentMistake={true} /></I18nProvider></ThemeProvider>);
    const why = await screen.findByRole('button', { name: 'Nega xato qildim?' });
    fireEvent.click(why);
    await waitFor(() => expect(h.ask).toHaveBeenCalledWith('sess1', expect.objectContaining({ task: 'WHY_WRONG' })));
    expect(await screen.findByText(/Avval urinib ko‘ring/)).toBeInTheDocument();
  });

  it('WEB-AS-05 a free-text question is sent as a QUESTION task', async () => {
    h.ask.mockResolvedValue({ status: 'ANSWERED', message: 'Good question — consider the subject.' });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Yordam kerakmi\?/ }));
    fireEvent.change(await screen.findByPlaceholderText('Savolingizni yozing…'), { target: { value: 'Why -s for he?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Yuborish' }));
    await waitFor(() => expect(h.ask).toHaveBeenCalledWith('sess1', expect.objectContaining({ task: 'QUESTION', question: 'Why -s for he?' })));
    expect(await screen.findByText('Good question — consider the subject.')).toBeInTheDocument();
  });
});
