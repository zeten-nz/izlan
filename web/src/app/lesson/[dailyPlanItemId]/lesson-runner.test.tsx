import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { ApiError } from '@/lib/api/errors';
import LessonRunnerPage from './page';

const h = vi.hoisted(() => ({ start: vi.fn(), get: vi.fn(), submit: vi.fn(), viewStep: vi.fn(), complete: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ dailyPlanItemId: 'dpi1' }), useRouter: () => ({ push: h.push, replace: vi.fn() }) }));
vi.mock('@/lib/api/learning', () => ({ startLesson: h.start, getLessonExecution: h.get, submitLessonActivity: h.submit, completeViewStep: h.viewStep, completeLesson: h.complete }));

const md = { id: 'a-md', type: 'EXPLANATION', position: 0, schemaVersion: 'lesson-activity-markdown/v1', markdown: 'Hello **world**' };
const sc = { id: 'a-sc', type: 'MINI_QUESTION', position: 1, format: 'single_choice', prompt: 'Pick A', options: [{ id: 'o1', text: 'A' }, { id: 'o2', text: 'B' }] };
const mc = { id: 'a-mc', type: 'PRACTICE', position: 2, format: 'multiple_choice', prompt: 'Pick some', options: [{ id: 'x', text: 'X' }, { id: 'y', text: 'Y' }, { id: 'z', text: 'Z' }] };
const img = { id: 'a-img', type: 'IMAGE', position: 0 };
const view = (activities: object[], lastActivityId: string | null = null) => ({
  lessonId: 'les1', lessonRevisionId: 'rev1', progress: { status: 'IN_PROGRESS', startedAt: 'x', lastActivityId }, lesson: { title: 'T', description: null, estimatedDurationMin: null }, activities,
});

function renderPage() {
  return render(<ThemeProvider><I18nProvider><LessonRunnerPage /></I18nProvider></ThemeProvider>);
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

describe('Lesson runner (WEB-LESSON)', () => {
  beforeEach(() => { Object.values(h).forEach((f) => f.mockReset()); });

  it('WEB-LESSON-01 start-or-resumes on entry and renders the first (view-only) activity', async () => {
    h.start.mockResolvedValue(view([md, sc]));
    renderPage();
    await waitFor(() => expect(h.start).toHaveBeenCalledWith('dpi1'));
    expect(screen.getByText('world')).toBeInTheDocument(); // markdown rendered (bold)
    expect(screen.getByRole('button', { name: 'Keyingi' })).toBeInTheDocument();
  });

  it('WEB-LESSON-02 acknowledging a view-only step advances to the next activity', async () => {
    h.start.mockResolvedValue(view([md, sc]));
    h.viewStep.mockResolvedValue({ lessonId: 'les1', activityId: 'a-md', recorded: true });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Keyingi' }));
    await waitFor(() => expect(h.viewStep).toHaveBeenCalledWith('les1', 'a-md'));
    expect(await screen.findByText('Pick A')).toBeInTheDocument(); // advanced to the objective
  });

  it('WEB-LESSON-03 an objective submit sends the real answer shape and renders backend correctness (no answerKey)', async () => {
    h.start.mockResolvedValue(view([sc])); // single objective — starts at it
    h.submit.mockResolvedValue({ attemptId: 't1', activityId: 'a-sc', attemptNo: 1, isCorrect: true, deterministicScore: 10000, status: 'SUBMITTED', submittedAt: 'x' });
    renderPage();
    await question('Pick A');
    fireEvent.click(screen.getByRole('radio', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Javobni tekshirish' }));
    await waitFor(() => expect(h.submit).toHaveBeenCalledWith('les1', 'a-sc', { selectedOptionId: 'o1' }));
    expect(await screen.findByText('To‘g‘ri')).toBeInTheDocument(); // backend-authoritative correctness
    expect(document.body.textContent).not.toContain('answerKey');
    expect(document.body.textContent).not.toContain('correctOptionIds');
  });

  it('WEB-LESSON-04 incorrect is shown from the backend result, never inferred', async () => {
    h.start.mockResolvedValue(view([sc]));
    h.submit.mockResolvedValue({ attemptId: 't1', activityId: 'a-sc', attemptNo: 1, isCorrect: false, deterministicScore: 0, status: 'SUBMITTED', submittedAt: 'x' });
    renderPage();
    await question('Pick A');
    fireEvent.click(screen.getByRole('radio', { name: 'B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Javobni tekshirish' }));
    expect(await screen.findByText('Noto‘g‘ri')).toBeInTheDocument();
  });

  it('WEB-LESSON-05 multiple_choice submits {selectedOptionIds}', async () => {
    h.start.mockResolvedValue(view([mc]));
    h.submit.mockResolvedValue({ attemptId: 't1', activityId: 'a-mc', attemptNo: 1, isCorrect: true, deterministicScore: 10000, status: 'SUBMITTED', submittedAt: 'x' });
    renderPage();
    await question('Pick some');
    fireEvent.click(screen.getByRole('checkbox', { name: 'X' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Y' }));
    fireEvent.click(screen.getByRole('button', { name: 'Javobni tekshirish' }));
    await waitFor(() => expect(h.submit).toHaveBeenCalledWith('les1', 'a-mc', { selectedOptionIds: ['x', 'y'] }));
  });

  it('WEB-LESSON-06 walking to the end completes the lesson via the backend (not client-derived)', async () => {
    h.start.mockResolvedValue(view([sc]));
    h.submit.mockResolvedValue({ attemptId: 't1', activityId: 'a-sc', attemptNo: 1, isCorrect: true, deterministicScore: 10000, status: 'SUBMITTED', submittedAt: 'x' });
    h.complete.mockResolvedValue({ lessonId: 'les1', lessonRevisionId: 'rev1', status: 'COMPLETED', completedAt: 'x', mastery: { measured: false } });
    renderPage();
    await question('Pick A');
    fireEvent.click(screen.getByRole('radio', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Javobni tekshirish' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keyingi' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Darsni yakunlash' }));
    await waitFor(() => expect(h.complete).toHaveBeenCalledWith('les1'));
    expect(await screen.findByText('Dars tugallandi')).toBeInTheDocument();
  });

  it('WEB-LESSON-07 a metadata-only (media/deferred) activity renders a safe placeholder, never a broken element', async () => {
    h.start.mockResolvedValue(view([img]));
    renderPage();
    expect(await screen.findByText('Bu kontent hozircha mavjud emas.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keyingi' })).toBeInTheDocument();
  });

  it('WEB-LESSON-08 LESSON_ALREADY_COMPLETED on start is a completed state, not an error', async () => {
    h.start.mockRejectedValue(new ApiError(409, 'LESSON_ALREADY_COMPLETED', 'x'));
    renderPage();
    expect(await screen.findByText('Dars tugallandi')).toBeInTheDocument();
  });

  it('WEB-LESSON-09 resumes at the activity after the backend lastActivityId', async () => {
    h.start.mockResolvedValue(view([md, sc], 'a-md')); // last touched = md → resume at sc
    renderPage();
    expect(await screen.findByText('Pick A')).toBeInTheDocument();
    expect(screen.queryByText('world')).toBeNull();
  });
});
