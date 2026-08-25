import { StrictMode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import PlacementPage from './page';

/**
 * REGRESSION: placement runner "answer → UI frozen, must re-enter" QA bug.
 *
 * Root cause: RunnerView held `const mounted = useRef(true)` with a cleanup-only effect
 * (`useEffect(() => () => { mounted.current = false; }, [])`). Under React StrictMode — which the app enables
 * (next.config.mjs: `reactStrictMode: true`) — the mount effect runs mount→cleanup→mount, latching
 * `mounted.current` to false for the component's whole life. Every `if (!mounted.current) return;` after an awaited
 * `submitResponse` then bailed BEFORE `setAttempt(next)`, so the runner never advanced to the next item / to the
 * Result even though the server had already progressed. Re-entering placement re-read the (advanced) attempt via the
 * GET path, which is why "back out + re-open" showed the next question.
 *
 * These tests render under <StrictMode> ON PURPOSE — that is the only thing that distinguishes them from the happy
 * WEB-PL-11 / WEB-PL-14 cases, and it is what makes them fail on the unfixed code and pass on the fix (reset
 * `mounted.current = true` in the effect SETUP). They also mock next/navigation with a STATEFUL router so that
 * `router.replace` actually updates `useSearchParams`, matching how the browser drives the attempt into the URL — no
 * remount / navigation / reload / manual refetch is triggered between submitting and seeing the next state.
 */

const store = vi.hoisted(() => {
  const s = {
    params: new URLSearchParams(''),
    listeners: new Set<() => void>(),
    setUrl(url: string) {
      s.params = new URLSearchParams(url.split('?')[1] ?? '');
      s.listeners.forEach((l) => l());
    },
  };
  return s;
});

const api = vi.hoisted(() => ({ availability: vi.fn(), start: vi.fn(), getAttempt: vi.fn(), submit: vi.fn(), intents: vi.fn(), snapshot: vi.fn(), derive: vi.fn(), roadmap: vi.fn() }));

vi.mock('next/navigation', async () => {
  const React = await import('react');
  return {
    // STATEFUL: replace() rewrites the params and notifies subscribers (like real useSearchParams), no remount.
    useRouter: () => ({ replace: (url: string) => store.setUrl(url), push: vi.fn() }),
    useSearchParams: () =>
      React.useSyncExternalStore(
        (cb: () => void) => { store.listeners.add(cb); return () => store.listeners.delete(cb); },
        () => store.params,
        () => store.params,
      ),
  };
});
vi.mock('@/lib/api/assessment', () => ({ checkPlacementAvailability: api.availability, startPlacement: api.start, getAttempt: api.getAttempt, submitResponse: api.submit }));
vi.mock('@/lib/api/skill-profile', () => ({ getDiagnosticSnapshot: api.snapshot, deriveDiagnostic: api.derive }));
vi.mock('@/lib/api/roadmap', () => ({ generateInitialRoadmap: api.roadmap }));
vi.mock('@/lib/api/onboarding', () => ({ fetchLearningIntents: api.intents }));

const INTENT = { id: 'li1', subject: { id: 's1', slug: 'english', title: 'English' }, track: { id: 't1', slug: 'general', title: 'General English' } };
const single = { id: 'it1', type: 'x', format: 'single_choice', prompt: 'Choose one', options: [{ id: 'o1', text: 'A' }, { id: 'o2', text: 'B' }] };
const tf = { id: 'it2', type: 'x', format: 'true_false', prompt: 'Is it true?', options: [{ id: 'yes', text: 'True' }, { id: 'no', text: 'False' }] };
const inProgress = (item: object, answered = 0) => ({ attemptId: 'att1', status: 'IN_PROGRESS', engineVersion: 'v1', progress: { answered, maxItems: 10 }, item, result: null });
const completed = () => ({ attemptId: 'att1', status: 'COMPLETED', engineVersion: 'v1', progress: { answered: 5, maxItems: 10 }, item: null, result: { answered: 5, objectiveCorrect: 3, coverageComplete: false, insufficientSkillIds: [] } });
const snap = { attemptId: 'att1', derivationVersion: 'v1', skills: [{ skillId: 'sk1', name: 'Grammar', masteryScoreBp: 6800, confidenceBp: 5000, displayLevel: null, measuredAt: '2026-01-01' }] };

function renderStrict() {
  // StrictMode mirrors the real app (next.config.mjs: reactStrictMode: true).
  return render(<StrictMode><ThemeProvider><I18nProvider><PlacementPage /></I18nProvider></ThemeProvider></StrictMode>);
}
async function focusedHeading(prompt: string) {
  await screen.findByText(prompt);
  await waitFor(() => expect(screen.getByRole('heading', { name: prompt })).toHaveFocus());
}

describe('Placement runner regression (StrictMode advance/completion — QA fix)', () => {
  beforeEach(() => {
    for (const f of Object.values(api)) f.mockReset();
    api.intents.mockResolvedValue([INTENT]);
    api.availability.mockResolvedValue({ available: true });
  });

  // §11 — submitting an answer must render the SERVER's next item immediately, with no remount/nav/reload/refetch.
  it('WEB-PL-R1 answering advances to the next item in place (no re-entry) under StrictMode', async () => {
    store.params = new URLSearchParams('learningIntentId=li1&attempt=att1');
    api.getAttempt.mockResolvedValue(inProgress(single, 0)); // current item A (Q1)
    api.submit.mockResolvedValue(inProgress(tf, 1)); // server advances to item B (Q2)

    renderStrict();
    await focusedHeading('Choose one');
    const getsBeforeSubmit = api.getAttempt.mock.calls.length; // StrictMode double-invokes the mount GET; snapshot it
    fireEvent.click(screen.getByRole('radio', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Javobni tasdiqlash' }));

    await waitFor(() => expect(api.submit).toHaveBeenCalledWith('att1', 'it1', { selectedOptionId: 'o1' }));
    // The bug: Q2 never appears (UI frozen on Q1) because the submit handler bailed before setAttempt(next).
    await screen.findByText('Is it true?', undefined, { timeout: 3000 });
    expect(screen.queryByText('Choose one')).toBeNull();
    // Advanced purely from the POST result: the submit triggered NO extra GET (no re-entry/refetch to progress).
    expect(api.getAttempt.mock.calls.length).toBe(getsBeforeSubmit);
  });

  // §11 (end-to-end) — the full browser path: Intro Start → router.replace drives ?attempt → Q1 → answer → Q2.
  it('WEB-PL-R2 full start→answer flow advances Q1→Q2 in place under StrictMode', async () => {
    store.params = new URLSearchParams('learningIntentId=li1'); // arrive from onboarding, no attempt yet
    api.start.mockResolvedValue(inProgress(single, 0));
    api.getAttempt.mockResolvedValue(inProgress(single, 0));
    api.submit.mockResolvedValue(inProgress(tf, 1));

    renderStrict();
    fireEvent.click(await screen.findByRole('button', { name: 'Testni boshlash' }));
    await focusedHeading('Choose one');
    fireEvent.click(screen.getByRole('radio', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Javobni tasdiqlash' }));

    await waitFor(() => expect(api.submit).toHaveBeenCalledWith('att1', 'it1', { selectedOptionId: 'o1' }));
    await screen.findByText('Is it true?', undefined, { timeout: 3000 });
    expect(screen.queryByText('Choose one')).toBeNull();
  });

  // §12 — the FINAL response returns a COMPLETED attempt: the Runner must exit and the Result must appear in place,
  // with no further answer submission possible.
  it('WEB-PL-R3 the final answer completes and shows the Result in place under StrictMode', async () => {
    store.params = new URLSearchParams('learningIntentId=li1&attempt=att1');
    api.getAttempt.mockResolvedValue(inProgress(single, 4)); // last item
    api.submit.mockResolvedValue(completed()); // final response completes the attempt
    api.snapshot.mockResolvedValue(snap);

    renderStrict();
    await focusedHeading('Choose one');
    fireEvent.click(screen.getByRole('radio', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Javobni tasdiqlash' }));

    // Result heading appears without reload/re-entry; the runner (its submit button) is gone.
    expect(await screen.findByText('Boshlash nuqtangiz tayyor', undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText('Choose one')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Javobni tasdiqlash' })).toBeNull();
    expect(api.submit).toHaveBeenCalledTimes(1); // exactly one submission — no extra answer after completion
  });
});
