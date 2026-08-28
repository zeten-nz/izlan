import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import TeachingRunnerPage from './page';

const h = vi.hoisted(() => ({ start: vi.fn(), get: vi.fn(), submit: vi.fn(), mastery: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ pointId: 'pt1' }), useRouter: () => ({ push: h.push, replace: vi.fn() }) }));
vi.mock('@/lib/api/v2-learning', () => ({
  startTeachingSession: h.start,
  fetchTeachingSession: h.get,
  submitTeachingActivity: h.submit,
  runMasteryCheck: h.mastery,
}));

const markdown = { id: 'md1', type: 'EXPLANATION', position: 0, schemaVersion: 'lesson-activity-markdown/v1', markdown: 'Present **Simple** rules', role: 'TEACH', kind: 'VIEW_ONLY', attempted: false, lastResult: null };
const objective = { id: 'obj1', type: 'MASTERY_TEST', position: 3, format: 'single_choice', prompt: 'Choose the correct form', options: [{ id: 'a', text: 'She works' }, { id: 'b', text: 'She work' }], role: 'EVIDENCE', kind: 'OBJECTIVE', attempted: false, lastResult: null };
const session = {
  id: 'sess1', roadmapPointId: 'pt1', roadmapPointRevisionId: 'rev1', blueprintRevisionId: 'bp1',
  title: 'Present Simple', learningOutcome: { canDo: ['use it for habits'] }, status: 'TEACHING',
  stages: [
    { id: 's1', position: 1, stageType: 'concept', title: 'Tushuncha bosqichi', description: 'concept desc', activities: [markdown] },
    { id: 's2', position: 2, stageType: 'mastery', title: 'Yakuniy bosqich', description: 'mastery desc', activities: [objective] },
  ],
  mastery: { requiredSkillCount: 3, outcome: null, satisfied: false, learned: false, canCheck: false, gates: null },
};

function renderPage() {
  return render(<ThemeProvider><I18nProvider><TeachingRunnerPage /></I18nProvider></ThemeProvider>);
}

async function question(prompt: string) {
  await screen.findByText(prompt);
  await waitFor(() => expect(screen.getByRole('heading', { name: prompt })).toHaveFocus());
}

describe('V2 Teaching runner (WEB-V2)', () => {
  beforeEach(() => { Object.values(h).forEach((f) => f.mockReset()); });

  it('WEB-V2-01 starts a session on entry and opens at the concept (not the objective)', async () => {
    h.start.mockResolvedValue(session);
    renderPage();
    await waitFor(() => expect(h.start).toHaveBeenCalledWith('pt1'));
    expect(await screen.findByRole('heading', { name: 'Tushuncha bosqichi' })).toBeInTheDocument(); // concept stage first
    expect(screen.getByRole('button', { name: /Davom etish/ })).toBeInTheDocument();
  });

  it('WEB-V2-02 walks concept → view → mastery → objective → LEARNED, server-authoritative, no answerKey leak', async () => {
    h.start.mockResolvedValue(session);
    h.submit.mockResolvedValue({ attemptId: 't1', activityId: 'obj1', attemptNo: 1, isCorrect: true, deterministicScore: 10000, remediation: null });
    h.mastery.mockResolvedValue({ outcome: 'SATISFIED', satisfied: true, learned: true, acquisitionId: 'acq1', gates: [] });
    renderPage();

    // Concept stage intro → the view (markdown) step.
    fireEvent.click(await screen.findByRole('button', { name: /Davom etish/ }));
    expect(await screen.findByText('Simple')).toBeInTheDocument(); // bold markdown rendered safely

    // View → mastery stage intro.
    fireEvent.click(screen.getByRole('button', { name: /Davom etish/ }));
    expect(await screen.findByRole('heading', { name: 'Yakuniy bosqich' })).toBeInTheDocument();

    // Mastery stage intro → the objective question.
    fireEvent.click(screen.getByRole('button', { name: /Davom etish/ }));
    await question('Choose the correct form');
    fireEvent.click(screen.getByRole('radio', { name: 'She works' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tekshirish' }));
    await waitFor(() => expect(h.submit).toHaveBeenCalledWith('sess1', 'obj1', { selectedOptionId: 'a' }));
    expect(await screen.findByText('To‘g‘ri')).toBeInTheDocument(); // backend-authoritative correctness

    // Objective feedback → the mastery-check step → run it → LEARNED panel.
    fireEvent.click(screen.getByRole('button', { name: /Davom etish/ }));
    expect(await screen.findByText('Bilimingizni tekshiring')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yakuniy tekshiruvni o‘tkazish' }));
    await waitFor(() => expect(h.mastery).toHaveBeenCalledWith('sess1'));
    expect(await screen.findByText('Tabriklaymiz — o‘zlashtirdingiz!')).toBeInTheDocument();

    expect(document.body.textContent).not.toContain('answerKey');
    expect(document.body.textContent).not.toContain('correctOptionIds');
  });

  it('WEB-V2-03 shows honest remediation on an incorrect answer (no answer reveal)', async () => {
    h.start.mockResolvedValue(session);
    h.submit.mockResolvedValue({ attemptId: 't2', activityId: 'obj1', attemptNo: 1, isCorrect: false, deterministicScore: 0, remediation: 'He/She/It bilan -s qoʻshiladi.' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Davom etish/ })); // concept → view
    fireEvent.click(await screen.findByRole('button', { name: /Davom etish/ })); // view → mastery intro
    fireEvent.click(await screen.findByRole('button', { name: /Davom etish/ })); // mastery intro → objective
    await question('Choose the correct form');
    fireEvent.click(screen.getByRole('radio', { name: 'She work' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tekshirish' }));
    expect(await screen.findByText('Noto‘g‘ri')).toBeInTheDocument();
    expect(screen.getByText(/qoʻshiladi/)).toBeInTheDocument(); // remediation hint shown
  });

  it('WEB-V2-04 a session already learned opens straight to the LEARNED panel (resume)', async () => {
    h.start.mockResolvedValue({ ...session, status: 'COMPLETED', mastery: { ...session.mastery, learned: true, satisfied: true, outcome: 'SATISFIED' } });
    renderPage();
    expect(await screen.findByText('Tabriklaymiz — o‘zlashtirdingiz!')).toBeInTheDocument();
  });
});
