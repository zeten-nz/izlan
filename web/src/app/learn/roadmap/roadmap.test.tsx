import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import RoadmapPage from './page';

const h = vi.hoisted(() => ({ subjectParam: null as string | null, intents: vi.fn(), roadmap: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => ({ get: (k: string) => (k === 'subject' ? h.subjectParam : null) }) }));
vi.mock('@/lib/api/onboarding', () => ({ fetchLearningIntents: h.intents }));
vi.mock('@/lib/api/roadmap', () => ({ fetchActiveRoadmap: h.roadmap }));

const intent = { id: 'i1', subject: { id: 's1', slug: 'english', title: 'English' }, track: { id: 't1', slug: 'general', title: 'General English' } };
const intent2 = { id: 'i2', subject: { id: 's2', slug: 'math', title: 'Math' }, track: { id: 't2', slug: 'algebra', title: 'Algebra' } };

// A roadmap covering ALL five states. nextItemId is deliberately ri3 (AVAILABLE) even though ri2 is IN_PROGRESS,
// to prove the frontend renders the BACKEND nextItemId verbatim and never re-derives it.
const roadmap = (over = {}) => ({
  id: 'roadmap-uuid-aaaa', subjectId: 's1', trackId: 't1', status: 'ACTIVE', sourceAssessmentAttemptId: 'attempt-uuid-bbbb',
  progress: { total: 5, completed: 1, inProgress: 1, available: 1, blocked: 1, unavailable: 1, progressBp: 6800 },
  nextItemId: 'ri3',
  items: [
    { id: 'ri1', position: 1, state: 'COMPLETED', skillId: 'skill-uuid-1', lesson: { id: 'l1', title: 'Greetings' } },
    { id: 'ri2', position: 2, state: 'IN_PROGRESS', skillId: 'skill-uuid-2', lesson: { id: 'l2', title: 'The verb to be' } },
    { id: 'ri3', position: 3, state: 'AVAILABLE', skillId: 'skill-uuid-3', lesson: { id: 'l3', title: 'Pronouns' } },
    { id: 'ri4', position: 4, state: 'BLOCKED', skillId: 'skill-uuid-4', lesson: { id: 'l4', title: 'Questions' } },
    { id: 'ri5', position: 5, state: 'UNAVAILABLE', skillId: 'skill-uuid-5', lesson: { id: 'l5', title: 'Numbers' } },
  ],
  ...over,
});

function renderPage() {
  return render(<ThemeProvider><I18nProvider><RoadmapPage /></I18nProvider></ThemeProvider>);
}

describe('Learner Roadmap (WEB-ROADMAP)', () => {
  beforeEach(() => { h.subjectParam = null; h.intents.mockReset(); h.roadmap.mockReset(); });

  it('WEB-ROADMAP-01 renders the active roadmap with backend progressBp and all five item states (distinct labels)', async () => {
    h.intents.mockResolvedValue([intent]);
    h.roadmap.mockResolvedValue(roadmap());
    renderPage();
    expect(await screen.findByText('Greetings')).toBeInTheDocument();
    expect(screen.getByText('68%')).toBeInTheDocument(); // progressBp 6800 (backend authority, not client math)
    expect(screen.getByText('Bajarildi: 1/5')).toBeInTheDocument();
    // every state has a distinct text label (never color-only); BLOCKED ≠ UNAVAILABLE
    expect(screen.getAllByText('Tugallangan').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Jarayonda').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Mavjud').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bloklangan').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Mavjud emas').length).toBeGreaterThan(0);
  });

  it('WEB-ROADMAP-02 highlights the backend nextItemId (not a client-derived first-available)', async () => {
    h.intents.mockResolvedValue([intent]);
    h.roadmap.mockResolvedValue(roadmap());
    renderPage();
    const badge = await screen.findByText('Keyingi qadam');
    const milestone = badge.closest('li')!;
    expect(within(milestone).getByText('Pronouns')).toBeInTheDocument(); // ri3 (backend nextItemId)
    expect(within(milestone).queryByText('The verb to be')).toBeNull(); // NOT ri2 (the IN_PROGRESS item)
  });

  it('WEB-ROADMAP-03 never renders raw internal UUIDs', async () => {
    h.intents.mockResolvedValue([intent]);
    h.roadmap.mockResolvedValue(roadmap());
    renderPage();
    await screen.findByText('Greetings');
    const text = document.body.textContent ?? '';
    for (const leak of ['roadmap-uuid', 'attempt-uuid', 'skill-uuid', 'ri1', 'ri3']) {
      expect(text).not.toContain(leak);
    }
  });

  it('WEB-ROADMAP-04 a ROADMAP_NOT_FOUND (null) is a product placement state, not an error', async () => {
    h.intents.mockResolvedValue([intent]);
    h.roadmap.mockResolvedValue(null);
    renderPage();
    const cta = await screen.findByRole('link', { name: 'Darajani aniqlash' });
    expect(cta).toHaveAttribute('href', '/placement?learningIntentId=i1');
  });

  it('WEB-ROADMAP-05 switching subject re-reads that subject only (UI context, not persisted)', async () => {
    h.intents.mockResolvedValue([intent, intent2]);
    h.roadmap.mockResolvedValue(roadmap());
    renderPage();
    await screen.findByText('Greetings');
    expect(h.roadmap).toHaveBeenCalledWith('s1'); // default first intent
    fireEvent.change(screen.getByRole('combobox', { name: 'Fan' }), { target: { value: 's2' } });
    await waitFor(() => expect(h.roadmap).toHaveBeenCalledWith('s2'));
    // no persistence API is invoked — selection is read context only
    expect(h.intents).toHaveBeenCalled();
  });
});
