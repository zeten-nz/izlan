import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { ApiError } from '@/lib/api/errors';
import ReviewSessionPage from './page';

const h = vi.hoisted(() => ({ get: vi.fn(), submit: vi.fn(), complete: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ sessionId: 'sess1' }), useRouter: () => ({ push: h.push, replace: vi.fn() }) }));
vi.mock('@/lib/api/review', () => ({ getReviewSession: h.get, submitReviewActivity: h.submit, completeReviewSession: h.complete }));

const q = (id: string, attempted = false) => ({ id, type: 'PRACTICE', position: 1, format: 'single_choice', prompt: `Prompt ${id}`, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], attempted, attemptCount: attempted ? 1 : 0, bestDeterministicScore: 0 });
const session = (over = {}) => ({ id: 'sess1', status: 'ACTIVE', skill: { id: 'sk1', name: 'Greetings' }, lesson: { id: 'les1' }, lessonRevisionId: 'rev1', startedAt: 'x', completedAt: null, mastery: { measured: false }, activities: [q('ra1')], ...over });

function renderPage() {
  return render(<ThemeProvider><I18nProvider><ReviewSessionPage /></I18nProvider></ThemeProvider>);
}

// Wait for a question to be READY to answer. The shared QuestionCard mount effect (keyed on the activity id) resets the
// selection and focuses the heading; because the activity is set outside act(), that effect can still be pending right
// after the prompt first renders under full-suite load. Interacting before it flushes lets the late reset clobber the
// selection (→ "submit called 0 times" flakes). Waiting for the heading to gain focus proves the effect ran — a
// test-timing artifact of the mocked async flow, not a product race (no real user clicks within that microtask window).
async function question(prompt: string) {
  await screen.findByText(prompt);
  await waitFor(() => expect(screen.getByRole('heading', { name: prompt })).toHaveFocus());
}

describe('Review session runner (WEB-REVSESS)', () => {
  beforeEach(() => { Object.values(h).forEach((f) => f.mockReset()); });

  it('WEB-REVSESS-01 loads the session and renders the first unanswered question (no answerKey)', async () => {
    h.get.mockResolvedValue(session());
    renderPage();
    await waitFor(() => expect(h.get).toHaveBeenCalledWith('sess1'));
    expect(screen.getByText('Prompt ra1')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('answerKey');
  });

  it('WEB-REVSESS-02 submitting sends the answer and shows backend correctness', async () => {
    h.get.mockResolvedValue(session());
    h.submit.mockResolvedValue({ attemptId: 't1', activityId: 'ra1', attemptNo: 1, isCorrect: true, deterministicScore: 10000, status: 'SUBMITTED', reviewSessionId: 'sess1', submittedAt: 'x' });
    renderPage();
    await question('Prompt ra1');
    fireEvent.click(screen.getByRole('radio', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Javobni tekshirish' }));
    await waitFor(() => expect(h.submit).toHaveBeenCalledWith('sess1', 'ra1', { selectedOptionId: 'a' }));
    expect(await screen.findByText('To‘g‘ri')).toBeInTheDocument();
  });

  it('WEB-REVSESS-03 completing after the last question is backend-authoritative', async () => {
    h.get.mockResolvedValue(session());
    h.submit.mockResolvedValue({ attemptId: 't1', activityId: 'ra1', attemptNo: 1, isCorrect: true, deterministicScore: 10000, status: 'SUBMITTED', submittedAt: 'x' });
    h.complete.mockResolvedValue(session({ status: 'COMPLETED', completedAt: 'x', activities: [q('ra1', true)] }));
    renderPage();
    await question('Prompt ra1');
    fireEvent.click(screen.getByRole('radio', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Javobni tekshirish' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keyingi' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Takrorlashni yakunlash' }));
    await waitFor(() => expect(h.complete).toHaveBeenCalledWith('sess1'));
    expect(await screen.findByText('Takrorlash tugallandi')).toBeInTheDocument();
  });

  it('WEB-REVSESS-04 resumes at the first unanswered activity (server-owned attempted flags)', async () => {
    h.get.mockResolvedValue(session({ activities: [q('ra1', true), q('ra2', false)] }));
    renderPage();
    expect(await screen.findByText('Prompt ra2')).toBeInTheDocument(); // skips the already-attempted ra1
  });

  it('WEB-REVSESS-05 a completed session shows the completed state on load', async () => {
    h.get.mockResolvedValue(session({ status: 'COMPLETED', completedAt: 'x', activities: [q('ra1', true)] }));
    renderPage();
    expect(await screen.findByText('Takrorlash tugallandi')).toBeInTheDocument();
  });

  it('WEB-REVSESS-07 renders a STRUCTURED review activity as a production task (not a broken choice card) and submits its shape', async () => {
    const structured = { id: 'rs1', type: 'PRACTICE', position: 1, schemaVersion: 'lesson-activity-structured/v1', format: 'sentence_order', prompt: 'Order the words.', tokens: [{ id: 't1', text: 'She' }, { id: 't2', text: 'works' }], attempted: false, attemptCount: 0, bestDeterministicScore: 0 };
    h.get.mockResolvedValue(session({ activities: [structured] }));
    h.submit.mockResolvedValue({ attemptId: 't1', activityId: 'rs1', attemptNo: 1, isCorrect: true, deterministicScore: 10000, status: 'SUBMITTED', submittedAt: 'x' });
    renderPage();
    await screen.findByText('Order the words.');
    fireEvent.click(screen.getByRole('button', { name: 'She' }));
    fireEvent.click(screen.getByRole('button', { name: 'works' }));
    fireEvent.click(screen.getByRole('button', { name: 'Javobni tekshirish' }));
    await waitFor(() => expect(h.submit).toHaveBeenCalledWith('sess1', 'rs1', { orderedTokenIds: ['t1', 't2'] }));
  });

  it('WEB-REVSESS-06 a not-found session is a product state with a route back to Today (the hub)', async () => {
    h.get.mockRejectedValue(new ApiError(404, 'REVIEW_SESSION_NOT_FOUND', 'x'));
    renderPage();
    expect(await screen.findByText('Takrorlash sessiyasi topilmadi')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Bugungi rejaga qaytish' })).toHaveAttribute('href', '/learn/today');
  });
});
