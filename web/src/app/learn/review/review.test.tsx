import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import ReviewLandingPage from './page';

const h = vi.hoisted(() => ({ intents: vi.fn(), candidates: vi.fn(), start: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push, replace: vi.fn() }) }));
vi.mock('@/lib/api/onboarding', () => ({ fetchLearningIntents: h.intents }));
vi.mock('@/lib/api/review', () => ({ fetchReviewCandidates: h.candidates, startReviewSession: h.start }));

const intent = { id: 'i1', subject: { id: 's1', slug: 'english', title: 'English' }, track: { id: 't1', slug: 'general', title: 'General' } };
const withCandidates = {
  subjectId: 's1',
  groups: [{ skill: { id: 'sk-uuid-1', name: 'Greetings' }, signalTypes: ['REPEATED_MISTAKE', 'WEAK_SKILL'], candidates: [{ lesson: { id: 'les-uuid-1', title: 'Saying hello', topicId: 'top-uuid-1' }, exposure: 'COMPLETED', directTrigger: true }] }],
  uncoveredSkillIds: ['weak-uuid-9'],
};

function renderPage() {
  return render(<ThemeProvider><I18nProvider><ReviewLandingPage /></I18nProvider></ThemeProvider>);
}

describe('Review landing (WEB-REVIEW)', () => {
  beforeEach(() => { Object.values(h).forEach((f) => f.mockReset()); });

  it('WEB-REVIEW-01 renders candidates grouped by skill with learner-friendly fields only (no UUIDs / signal codes)', async () => {
    h.intents.mockResolvedValue([intent]);
    h.candidates.mockResolvedValue(withCandidates);
    renderPage();
    expect(await screen.findByText('Greetings')).toBeInTheDocument(); // skill group heading
    expect(screen.getByText('Saying hello')).toBeInTheDocument(); // candidate lesson title
    const text = document.body.textContent ?? '';
    for (const leak of ['sk-uuid', 'les-uuid', 'top-uuid', 'weak-uuid', 'REPEATED_MISTAKE', 'WEAK_SKILL']) {
      expect(text).not.toContain(leak);
    }
  });

  it('WEB-REVIEW-02 no candidates is a calm empty product state, not an error', async () => {
    h.intents.mockResolvedValue([intent]);
    h.candidates.mockResolvedValue({ subjectId: 's1', groups: [], uncoveredSkillIds: [] });
    renderPage();
    expect(await screen.findByText('Bugun takrorlash uchun alohida mavzu yo‘q')).toBeInTheDocument();
  });

  it('WEB-REVIEW-03 starting a candidate POSTs skill+lesson and routes to the session', async () => {
    h.intents.mockResolvedValue([intent]);
    h.candidates.mockResolvedValue(withCandidates);
    h.start.mockResolvedValue({ id: 'sess-9', status: 'ACTIVE', skill: { id: 'sk-uuid-1', name: 'Greetings' }, lesson: { id: 'les-uuid-1' }, lessonRevisionId: 'r', startedAt: 'x', completedAt: null, mastery: { measured: false }, activities: [] });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Takrorlashni boshlash' }));
    await waitFor(() => expect(h.start).toHaveBeenCalledWith('s1', 'sk-uuid-1', 'les-uuid-1'));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/review-session/sess-9'));
  });
});
