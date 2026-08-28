import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { ApiError, NetworkError, UnauthenticatedError } from '@/lib/api/errors';
import PlacementPage from './page';

const h = vi.hoisted(() => ({
  replace: vi.fn(),
  params: {} as Record<string, string | undefined>,
  availability: vi.fn(), start: vi.fn(), getAttempt: vi.fn(), submit: vi.fn(),
  snapshot: vi.fn(), derive: vi.fn(), roadmap: vi.fn(), intents: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: h.replace, push: vi.fn() }),
  useSearchParams: () => ({ get: (k: string) => h.params[k] ?? null }),
}));
vi.mock('@/lib/api/assessment', () => ({ checkPlacementAvailability: h.availability, startPlacement: h.start, getAttempt: h.getAttempt, submitResponse: h.submit }));
vi.mock('@/lib/api/skill-profile', () => ({ getDiagnosticSnapshot: h.snapshot, deriveDiagnostic: h.derive }));
vi.mock('@/lib/api/roadmap', () => ({ generateInitialRoadmap: h.roadmap }));
vi.mock('@/lib/api/onboarding', () => ({ fetchLearningIntents: h.intents }));

const INTENT = { id: 'li1', subject: { id: 's1', slug: 'english', title: 'English' }, track: { id: 't1', slug: 'general', title: 'General English' } };
const single = { id: 'it1', type: 'x', format: 'single_choice', prompt: 'Choose one', options: [{ id: 'o1', text: 'A' }, { id: 'o2', text: 'B' }] };
const tf = { id: 'it2', type: 'x', format: 'true_false', prompt: 'Is it true?', options: [{ id: 'yes', text: 'True' }, { id: 'no', text: 'False' }] };
const multi = { id: 'it3', type: 'x', format: 'multiple_choice', prompt: 'Choose many', options: [{ id: 'm1', text: 'X' }, { id: 'm2', text: 'Y' }, { id: 'm3', text: 'Z' }] };
const inProgress = (item: object, answered = 0, maxItems = 10) => ({ attemptId: 'att1', status: 'IN_PROGRESS', engineVersion: 'v1', progress: { answered, maxItems }, item, result: null });
const completed = () => ({ attemptId: 'att1', status: 'COMPLETED', engineVersion: 'v1', progress: { answered: 5, maxItems: 10 }, item: null, result: { answered: 5, objectiveCorrect: 3, coverageComplete: false, insufficientSkillIds: ['sk9'] } });
const snap = { attemptId: 'att1', derivationVersion: 'v1', skills: [
  { skillId: 'sk1', name: 'Grammar', masteryScoreBp: 6800, confidenceBp: 5000, displayLevel: null, measuredAt: '2026-01-01' },
  { skillId: 'sk2', name: 'Vocabulary', masteryScoreBp: 8200, confidenceBp: 6000, displayLevel: null, measuredAt: '2026-01-01' },
] };

function renderPage() {
  return render(<ThemeProvider><I18nProvider><PlacementPage /></I18nProvider></ThemeProvider>);
}

// Wait for a question to be READY to answer. QuestionCard's mount effect (keyed on item.id) resets the selection and
// focuses the heading; because the attempt is set outside act(), that effect can still be pending right after the prompt
// first renders under full-suite load. Interacting before it flushes lets the late reset clobber the radio/checkbox
// selection (→ "submit called 0 times" flakes). Waiting for the heading to gain focus proves the effect ran. This is a
// test-timing artifact of the mocked async flow, NOT a product race (no real user clicks within that microtask window).
async function question(prompt: string) {
  await screen.findByText(prompt);
  await waitFor(() => expect(screen.getByRole('heading', { name: prompt })).toHaveFocus());
}

describe('Placement (WEB-PL)', () => {
  beforeEach(() => {
    for (const f of [h.replace, h.availability, h.start, h.getAttempt, h.submit, h.snapshot, h.derive, h.roadmap, h.intents]) f.mockReset();
    h.params = {};
    h.intents.mockResolvedValue([INTENT]);
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  // ── Intro ──
  it('WEB-PL-01 availability=true shows the intro with subject context and a Start CTA', async () => {
    h.params = { learningIntentId: 'li1' };
    h.availability.mockResolvedValue({ available: true });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Testni boshlash' })).toBeInTheDocument();
    expect(screen.getByText('English')).toBeInTheDocument();
    expect(screen.getByText('General English')).toBeInTheDocument();
  });

  it('WEB-PL-02 availability=false shows a calm unavailable state (no Start CTA, no fabricated test)', async () => {
    h.params = { learningIntentId: 'li1' };
    h.availability.mockResolvedValue({ available: false });
    renderPage();
    expect(await screen.findByText('Hozircha daraja aniqlash mavjud emas')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Testni boshlash' })).toBeNull();
  });

  it('WEB-PL-03 a missing learningIntentId shows the no-intent state (back to onboarding)', async () => {
    h.params = {};
    renderPage();
    expect(await screen.findByText('Yo‘nalish topilmadi')).toBeInTheDocument();
  });

  it('WEB-PL-20 an availability network failure shows the network message (not a false claim)', async () => {
    h.params = { learningIntentId: 'li1' };
    h.availability.mockRejectedValue(new NetworkError());
    renderPage();
    expect(await screen.findByText(/Server bilan bog/)).toBeInTheDocument();
  });

  // ── Start ──
  it('WEB-PL-04 Start POSTs placement/start with the real learningIntentId and carries the attempt in the URL', async () => {
    h.params = { learningIntentId: 'li1' };
    h.availability.mockResolvedValue({ available: true });
    h.start.mockResolvedValue(inProgress(single));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Testni boshlash' }));
    await waitFor(() => expect(h.start).toHaveBeenCalledWith('li1'));
    expect(h.replace).toHaveBeenCalledWith('/placement?learningIntentId=li1&attempt=att1');
  });

  // ── Runner (attempt already in the URL → resume/read path) ──
  it('WEB-PL-05 single_choice: radios; submit disabled until a selection; submits {selectedOptionId}', async () => {
    h.params = { learningIntentId: 'li1', attempt: 'att1' };
    h.getAttempt.mockResolvedValue(inProgress(single, 0));
    h.submit.mockResolvedValue(inProgress(tf, 1));
    renderPage();
    await question('Choose one');
    const submit = screen.getByRole('button', { name: 'Javobni tasdiqlash' });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'A' }));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(h.submit).toHaveBeenCalledWith('att1', 'it1', { selectedOptionId: 'o1' }));
  });

  it('WEB-PL-06 true_false submits {selectedOptionId}', async () => {
    h.params = { learningIntentId: 'li1', attempt: 'att1' };
    h.getAttempt.mockResolvedValue(inProgress(tf, 0));
    h.submit.mockResolvedValue(inProgress(single, 1));
    renderPage();
    await question('Is it true?');
    fireEvent.click(screen.getByRole('radio', { name: 'True' }));
    fireEvent.click(screen.getByRole('button', { name: 'Javobni tasdiqlash' }));
    await waitFor(() => expect(h.submit).toHaveBeenCalledWith('att1', 'it2', { selectedOptionId: 'yes' }));
  });

  it('WEB-PL-07 multiple_choice: checkboxes; submits {selectedOptionIds} from the actual selection', async () => {
    h.params = { learningIntentId: 'li1', attempt: 'att1' };
    h.getAttempt.mockResolvedValue(inProgress(multi, 0));
    h.submit.mockResolvedValue(completed());
    h.snapshot.mockResolvedValue(snap);
    renderPage();
    await question('Choose many');
    fireEvent.click(screen.getByRole('checkbox', { name: 'X' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Z' }));
    fireEvent.click(screen.getByRole('button', { name: 'Javobni tasdiqlash' }));
    await waitFor(() => expect(h.submit).toHaveBeenCalledWith('att1', 'it3', { selectedOptionIds: ['m1', 'm3'] }));
  });

  it('WEB-PL-09 submit is disabled with no selection', async () => {
    h.params = { learningIntentId: 'li1', attempt: 'att1' };
    h.getAttempt.mockResolvedValue(inProgress(single, 0));
    renderPage();
    await screen.findByText('Choose one');
    expect(screen.getByRole('button', { name: 'Javobni tasdiqlash' })).toBeDisabled();
  });

  it('WEB-PL-10 progress + question label come from the SERVER progress (answered/maxItems)', async () => {
    h.params = { learningIntentId: 'li1', attempt: 'att1' };
    h.getAttempt.mockResolvedValue(inProgress(single, 3, 10));
    renderPage();
    await screen.findByText('Choose one');
    expect(screen.getByText('4-savol')).toBeInTheDocument(); // answered(3) + 1
    expect(screen.getByRole('progressbar', { name: 'Daraja aniqlash jarayoni' })).toHaveAttribute('aria-valuenow', '30');
  });

  it('WEB-PL-11 the next item is rendered from the server response; no correctness feedback', async () => {
    h.params = { learningIntentId: 'li1', attempt: 'att1' };
    h.getAttempt.mockResolvedValue(inProgress(single, 0));
    h.submit.mockResolvedValue(inProgress(tf, 1));
    renderPage();
    await question('Choose one');
    fireEvent.click(screen.getByRole('radio', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Javobni tasdiqlash' }));
    await screen.findByText('Is it true?', undefined, { timeout: 3000 }); // advanced to the server's next item
    expect(screen.queryByText(/to‘g‘ri|noto‘g‘ri|correct|wrong/i)).toBeNull();
  });

  it('WEB-PL-12 a duplicate rapid submit is guarded (submit disabled while in flight → one POST)', async () => {
    h.params = { learningIntentId: 'li1', attempt: 'att1' };
    h.getAttempt.mockResolvedValue(inProgress(single, 0));
    let resolve!: (v: unknown) => void;
    h.submit.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderPage();
    await screen.findByText('Choose one');
    // QuestionCard's mount effect resets the selection on item change and focuses the heading. Under full-suite load the
    // attempt is set outside act(), so that effect can still be pending here; wait for it (heading focused) before
    // interacting, else its late flush would clobber the radio selection — a test-timing artifact, not a product race.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Choose one' })).toHaveFocus());
    fireEvent.click(screen.getByRole('radio', { name: 'A' }));
    const submit = screen.getByRole('button', { name: 'Javobni tasdiqlash' });
    await waitFor(() => expect(submit).toBeEnabled()); // selection registered
    fireEvent.click(submit);
    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1)); // exactly one POST (submitting disables the button)
    fireEvent.click(submit); // second rapid click while in-flight — ignored
    resolve(inProgress(tf, 1));
    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
  });

  // ── Reload / resume ──
  it('WEB-PL-13 reloading with ?attempt reads the attempt (GET) and does NOT advance', async () => {
    h.params = { learningIntentId: 'li1', attempt: 'att1' };
    h.getAttempt.mockResolvedValue(inProgress(single, 2));
    renderPage();
    await screen.findByText('Choose one');
    expect(h.getAttempt).toHaveBeenCalledWith('att1');
    expect(h.submit).not.toHaveBeenCalled(); // pure read — no progression on reload
    expect(screen.getByText('3-savol')).toBeInTheDocument();
  });

  // ── Completion + Result ──
  it('WEB-PL-14 a COMPLETED response transitions to the Result state', async () => {
    h.params = { learningIntentId: 'li1', attempt: 'att1' };
    h.getAttempt.mockResolvedValue(inProgress(single, 4));
    h.submit.mockResolvedValue(completed());
    h.snapshot.mockResolvedValue(snap);
    renderPage();
    await question('Choose one');
    fireEvent.click(screen.getByRole('radio', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Javobni tasdiqlash' }));
    expect(await screen.findByText('Boshlash nuqtangiz tayyor', undefined, { timeout: 3000 })).toBeInTheDocument();
  });

  it('WEB-PL-15 the skill profile renders with basis-point conversion; mastery and confidence stay distinct', async () => {
    h.params = { learningIntentId: 'li1', attempt: 'att1' };
    h.getAttempt.mockResolvedValue(completed());
    h.snapshot.mockResolvedValue(snap);
    renderPage();
    expect(await screen.findByText('68%')).toBeInTheDocument(); // mastery 6800bp → 68% (unique text)
    expect(screen.getByText('82%')).toBeInTheDocument(); // 8200bp → 82%
    expect(screen.getByText('Ishonchlilik: 50%')).toBeInTheDocument(); // confidence distinct from mastery (5000bp)
    expect(screen.getAllByText('Grammar').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Vocabulary').length).toBeGreaterThan(0);
  });

  it('WEB-PL-16 insufficient-evidence skills show a calm note and never a raw UUID', async () => {
    h.params = { learningIntentId: 'li1', attempt: 'att1' };
    h.getAttempt.mockResolvedValue(completed()); // insufficientSkillIds: ['sk9'] (not in the snapshot)
    h.snapshot.mockResolvedValue(snap);
    renderPage();
    expect(await screen.findByText(/hali yetarli ma’lumot yo‘q/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('sk9');
  });

  it('WEB-PL-17 a not-yet-derived snapshot triggers exactly one derive repair, then renders', async () => {
    h.params = { learningIntentId: 'li1', attempt: 'att1' };
    h.getAttempt.mockResolvedValue(completed());
    h.snapshot.mockRejectedValue(new ApiError(409, 'SKILL_PROFILE_NOT_DERIVED', 'x'));
    h.derive.mockResolvedValue(snap);
    renderPage();
    expect(await screen.findByText('68%')).toBeInTheDocument(); // repaired snapshot rendered
    expect(h.derive).toHaveBeenCalledTimes(1);
  });

  // ── Roadmap ──
  it('WEB-PL-18 the Result CTA generates the initial roadmap then routes to /learn', async () => {
    h.params = { learningIntentId: 'li1', attempt: 'att1' };
    h.getAttempt.mockResolvedValue(completed());
    h.snapshot.mockResolvedValue(snap);
    h.roadmap.mockResolvedValue({ roadmap: { id: 'r1', status: 'ACTIVE' }, uncoveredSkillIds: [] });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'O‘rganishni boshlash' }));
    await waitFor(() => expect(h.roadmap).toHaveBeenCalledWith('att1'));
    expect(h.replace).toHaveBeenCalledWith('/learn');
  });

  it('WEB-PL-25 with ?v2=1 a COMPLETED diagnostic routes to the V2 decision/result flow (not the V1 result)', async () => {
    h.params = { learningIntentId: 'li1', attempt: 'att1', v2: '1' };
    h.getAttempt.mockResolvedValue(completed());
    renderPage();
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/placement/v2/result/att1'));
    expect(screen.queryByText('Boshlash nuqtangiz tayyor')).toBeNull(); // never the V1 snapshot result
  });

  it('WEB-PL-19 a no-eligible-content roadmap failure is recoverable (message + a continue link)', async () => {
    h.params = { learningIntentId: 'li1', attempt: 'att1' };
    h.getAttempt.mockResolvedValue(completed());
    h.snapshot.mockResolvedValue(snap);
    h.roadmap.mockRejectedValue(new ApiError(409, 'ROADMAP_NO_ELIGIBLE_CONTENT', 'x'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'O‘rganishni boshlash' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Bosh sahifaga o‘tish' })).toHaveAttribute('href', '/learn');
    expect(h.replace).not.toHaveBeenCalledWith('/learn');
  });

  // ── Errors ──
  it('WEB-PL-21 a response conflict resyncs from the server and shows a recoverable message', async () => {
    h.params = { learningIntentId: 'li1', attempt: 'att1' };
    h.getAttempt.mockResolvedValueOnce(inProgress(single, 0)); // initial
    h.submit.mockRejectedValue(new ApiError(409, 'ASSESSMENT_RESPONSE_CONFLICT', 'x'));
    h.getAttempt.mockResolvedValueOnce(inProgress(tf, 1)); // resync
    renderPage();
    await question('Choose one');
    fireEvent.click(screen.getByRole('radio', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Javobni tasdiqlash' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Joriy holatga qaytdik'));
    expect(h.submit).toHaveBeenCalledTimes(1);
  });

  it('WEB-PL-22 a session-loss error shows the session message (not network)', async () => {
    h.params = { learningIntentId: 'li1', attempt: 'att1' };
    h.getAttempt.mockResolvedValue(inProgress(single, 0));
    h.submit.mockRejectedValue(new UnauthenticatedError());
    renderPage();
    await question('Choose one');
    fireEvent.click(screen.getByRole('radio', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Javobni tasdiqlash' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Sessiya tugagan'));
  });

  it('WEB-PL-23 an aborted submit never produces a banner', async () => {
    h.params = { learningIntentId: 'li1', attempt: 'att1' };
    h.getAttempt.mockResolvedValue(inProgress(single, 0));
    h.submit.mockRejectedValue(new DOMException('aborted', 'AbortError'));
    renderPage();
    await screen.findByText('Choose one');
    fireEvent.click(screen.getByRole('radio', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Javobni tasdiqlash' }));
    await waitFor(() => expect(h.submit).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('WEB-PL-24 a network failure ends the spinner, shows a retryable message, keeps the answer, and can retry', async () => {
    h.params = { learningIntentId: 'li1', attempt: 'att1' };
    h.getAttempt.mockResolvedValue(inProgress(single, 0));
    h.submit.mockRejectedValueOnce(new NetworkError()); // transient failure (e.g. refresh transport blip) — retryable
    renderPage();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Choose one' })).toHaveFocus());
    fireEvent.click(screen.getByRole('radio', { name: 'A' }));
    const submit = screen.getByRole('button', { name: 'Javobni tasdiqlash' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    // spinner ends + a retryable network message (NOT a false "session expired"); the question/answer are kept
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Server bilan bog/));
    await waitFor(() => expect(submit).toBeEnabled());
    expect(screen.getByRole('radio', { name: 'A' })).toBeChecked();
    // retry now succeeds (advances to the next item)
    h.submit.mockResolvedValueOnce(inProgress(tf, 1));
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByText('Is it true?')).toBeInTheDocument());
    expect(h.submit).toHaveBeenCalledTimes(2);
  });
});
