import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { NetworkError } from '@/lib/api/errors';
import ProgressPage from './page';

const h = vi.hoisted(() => ({
  subject: null as string | null,
  intents: vi.fn(),
  skillProfile: vi.fn(),
  roadmap: vi.fn(),
  xp: vi.fn(),
  izl: vi.fn(),
  missions: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useSearchParams: () => ({ get: () => h.subject }) }));
vi.mock('@/lib/api/onboarding', () => ({ fetchLearningIntents: h.intents }));
vi.mock('@/lib/api/skill-profile', () => ({ getCurrentSkillProfile: h.skillProfile }));
vi.mock('@/lib/api/v2-learning', () => ({ fetchV2Roadmap: h.roadmap }));
vi.mock('@/lib/api/xp', () => ({ getXpProgression: h.xp }));
vi.mock('@/lib/api/izl', () => ({ getIzlBalance: h.izl }));
vi.mock('@/lib/api/rewards', () => ({ fetchTodayMissions: h.missions }));

// Track title is deliberately NOT a CEFR value, so a stray "A1"/"A2" would only come from a fabricated skill level.
const intent = (id: string, subjectId: string, title: string) => ({ id, subject: { id: subjectId, slug: subjectId, title }, track: { id: `t-${id}`, slug: 'general', title: 'General' } });

const skillProfile = {
  subject: { id: 's1', title: 'English' },
  skills: [
    { skillId: 'sk1', name: 'Grammar', masteryScoreBp: 8500, confidenceBp: 6000, evidenceCount: 4, displayLevel: null, lastMeasurementAt: 'x' },
    { skillId: 'sk2', name: 'Vocabulary', masteryScoreBp: 4000, confidenceBp: null, evidenceCount: 1, displayLevel: null, lastMeasurementAt: 'x' },
  ],
};
// V2 roadmap: a data-driven point set. 2 acquired (learned + validated) of 4 → 50% overall progress.
const pt = (over: Record<string, unknown> = {}) => ({
  roadmapPointId: 'p', pointKey: 'K', title: 'Point', learningOutcome: null, estimatedEffortMin: 15, sortOrder: 1,
  availability: 'AVAILABLE', acquisition: null, attention: 'NONE', attentionReason: null, attentionSkill: null,
  learned: false, validated: false, activeSessionId: null, ...over,
});
const roadmap = {
  generation: { id: 'g1', subjectId: 's1', trackId: 't1', generationNo: 1, generatedAt: 'x' },
  points: [
    pt({ roadmapPointId: 'p1', title: 'Point 1', learned: true, acquisition: 'LEARNED' }),
    pt({ roadmapPointId: 'p2', title: 'Point 2', validated: true, acquisition: 'VALIDATED' }),
    pt({ roadmapPointId: 'p3', title: 'Point 3' }),
    pt({ roadmapPointId: 'p4', title: 'Point 4' }),
  ],
};
const xp = { totalXp: 120, progressionXp: 120, currentLevel: 2, currentLevelStartXp: 100, nextLevelXp: 300, xpIntoLevel: 20, xpToNextLevel: 180, progressBp: 1000, progressionVersion: 'xp-progression-v1' };
const izl = { balanceIzl: 20, reservedIzl: 0, availableIzl: 20 };
const missions = { localDate: '2026-08-25', timezone: 'Asia/Tashkent', missions: [
  { code: 'LEARN_TODAY', completed: true, completedAt: '2026-08-25T08:00:00Z', policyVersion: 'learn-today-mission-v1' },
  { code: 'MASTERY_TEST_90', completed: false, completedAt: null, policyVersion: 'mastery-test-90-mission-v1' },
] };

function renderPage() {
  return render(<ThemeProvider><I18nProvider><ProgressPage /></I18nProvider></ThemeProvider>);
}

describe('Progress / Results (WEB-PROG)', () => {
  beforeEach(() => {
    h.subject = null;
    for (const f of [h.intents, h.skillProfile, h.roadmap, h.xp, h.izl, h.missions]) f.mockReset();
    h.intents.mockResolvedValue([intent('li1', 's1', 'English')]);
    h.skillProfile.mockResolvedValue(skillProfile);
    h.roadmap.mockResolvedValue(roadmap);
    h.xp.mockResolvedValue(xp);
    h.izl.mockResolvedValue(izl);
    h.missions.mockResolvedValue(missions);
  });

  it('WEB-PROG-01 renders skill mastery from backend basis points (8500bp → 85%)', async () => {
    renderPage();
    expect(await screen.findByText('85%')).toBeInTheDocument(); // 8500 / 100
    expect(screen.getByText('40%')).toBeInTheDocument(); // 4000 / 100 (Vocabulary)
    expect(screen.getAllByText('Grammar').length).toBeGreaterThan(0);
  });

  it('WEB-PROG-02 confidence is shown separately from mastery, and omitted when null', async () => {
    renderPage();
    // distinct label + value for the skill that has confidence
    expect(await screen.findByText('Ishonchlilik: 60%')).toBeInTheDocument(); // 6000 / 100
    // Vocabulary has confidenceBp null → no confidence line for it (exactly one confidence label total)
    expect(screen.getAllByText(/Ishonchlilik/)).toHaveLength(1);
  });

  it('WEB-PROG-03 evidence count is rendered from the backend', async () => {
    renderPage();
    expect(await screen.findByText('Dalillar: 4')).toBeInTheDocument();
    expect(screen.getByText('Dalillar: 1')).toBeInTheDocument();
  });

  it('WEB-PROG-04 no fabricated CEFR/level when displayLevel is null', async () => {
    renderPage();
    await screen.findByText('85%');
    // displayLevel is null → we must never render an A1/A2/B1… level label
    expect(screen.queryByText(/^(A1|A2|B1|B2|C1|C2)$/)).toBeNull();
  });

  it('WEB-PROG-05 raw skill UUIDs are never exposed', async () => {
    renderPage();
    await screen.findByText('85%');
    expect(document.body.textContent).not.toContain('sk1');
    expect(document.body.textContent).not.toContain('sk2');
  });

  it('WEB-PROG-06 XP total and its real backend level render (no fabricated rank/badge)', async () => {
    renderPage();
    expect(await screen.findByText('120')).toBeInTheDocument(); // totalXp
    expect(screen.getByText('Daraja 2')).toBeInTheDocument(); // currentLevel (a real backend value)
    expect(screen.getByText('O‘rganish ballari')).toBeInTheDocument(); // XP description
  });

  it('WEB-PROG-07 IZL available balance renders with its own label; reserved hidden when zero', async () => {
    renderPage();
    await screen.findByText('Mavjud balans');
    expect(screen.getByText('20')).toBeInTheDocument(); // availableIzl
    expect(screen.getByText('Platforma mukofot valyutasi')).toBeInTheDocument(); // IZL description
    expect(screen.queryByText(/Band qilingan/)).toBeNull(); // reserved 0 → not shown
  });

  it('WEB-PROG-08 XP and IZL are visually/semantically distinct (never one combined score)', async () => {
    renderPage();
    await screen.findByText('120');
    // separate descriptions prove they are different systems, not one interchangeable balance
    expect(screen.getByText('O‘rganish ballari')).toBeInTheDocument();
    expect(screen.getByText('Platforma mukofot valyutasi')).toBeInTheDocument();
  });

  it('WEB-PROG-09 IZL reserved and total are shown (and labelled) when a hold exists', async () => {
    h.izl.mockResolvedValue({ balanceIzl: 100, reservedIzl: 30, availableIzl: 70 });
    renderPage();
    await screen.findByText('Mavjud balans');
    expect(screen.getByText('70')).toBeInTheDocument(); // available (not the total)
    expect(screen.getByText('Band qilingan: 30')).toBeInTheDocument(); // reserved labelled, never as spendable
    expect(screen.getByText('Jami: 100')).toBeInTheDocument();
  });

  it('WEB-PROG-10 today missions show real status with no Claim action', async () => {
    renderPage();
    await screen.findByText('Bugun o‘rganish');
    expect(screen.getByText('Bajarildi')).toBeInTheDocument(); // LEARN_TODAY completed
    expect(screen.getByText('Testdan 90%+ natija')).toBeInTheDocument();
    expect(screen.getByText('Bajarilmagan')).toBeInTheDocument(); // MASTERY_TEST_90 pending
    // rewards are auto-granted — there is NO claim/redeem button anywhere
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('WEB-PROG-11 internal mission codes are never rendered', async () => {
    renderPage();
    await screen.findByText('Bugun o‘rganish');
    expect(document.body.textContent).not.toContain('LEARN_TODAY');
    expect(document.body.textContent).not.toContain('MASTERY_TEST_90');
  });

  it('WEB-PROG-12 zero XP and zero IZL are calm valid states, not errors', async () => {
    h.xp.mockResolvedValue({ ...xp, totalXp: 0, progressionXp: 0, currentLevel: 1, xpToNextLevel: 100, progressBp: 0 });
    h.izl.mockResolvedValue({ balanceIzl: 0, reservedIzl: 0, availableIzl: 0 });
    renderPage();
    await screen.findByText('Daraja 1');
    expect(screen.getAllByText('0').length).toBeGreaterThan(0); // zero XP and zero IZL both render
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('WEB-PROG-13 a subject with no measured skills shows a calm empty state, not an error', async () => {
    h.skillProfile.mockResolvedValue({ subject: { id: 's1', title: 'English' }, skills: [] });
    renderPage();
    expect(await screen.findByText('Hali ko‘nikma ma’lumoti yo‘q')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('WEB-PROG-14 no active roadmap shows a calm no-progress state', async () => {
    h.roadmap.mockResolvedValue(null);
    renderPage();
    expect(await screen.findByText('Hozircha progress yo‘q')).toBeInTheDocument();
  });

  it('WEB-PROG-15 a network failure surfaces the retryable server/network message', async () => {
    h.xp.mockRejectedValue(new NetworkError());
    renderPage();
    await waitFor(() => expect(screen.getByText(/Server bilan bog/)).toBeInTheDocument());
  });

  it('WEB-PROG-16 an aborted/cancelled read is ignored (stays calm, no error banner)', async () => {
    h.xp.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    renderPage();
    // no scary error text and no alert — the page stays in the calm loading state
    await waitFor(() => expect(screen.getByLabelText('Yuklanmoqda…')).toBeInTheDocument());
    expect(screen.queryByText(/Server bilan bog/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('WEB-PROG-17 the strongest and focus skills are highlighted from mastery order', async () => {
    renderPage();
    await screen.findByText('Kuchli tomon');
    // Grammar (85%) is the strength; Vocabulary (40%) needs focus
    const strength = screen.getByText('Kuchli tomon').closest('div');
    const focus = screen.getByText('Ko‘proq e’tibor kerak').closest('div');
    expect(strength?.textContent).toContain('Grammar');
    expect(focus?.textContent).toContain('Vocabulary');
  });

  it('WEB-PROG-18 multiple subjects: the selector switches the read context (no persisted preference)', async () => {
    h.intents.mockResolvedValue([intent('li1', 's1', 'English'), intent('li2', 's2', 'Math')]);
    renderPage();
    const select = await screen.findByRole('combobox', { name: 'Fan' });
    expect(select).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 's2' } });
    await waitFor(() => expect(h.skillProfile).toHaveBeenCalledWith('s2', 'Math'));
  });

  it('WEB-PROG-19 the frontend never grants XP/IZL — it only reads (one call each, no mutation)', async () => {
    renderPage();
    await screen.findByText('120');
    expect(h.xp).toHaveBeenCalledTimes(1);
    expect(h.izl).toHaveBeenCalledTimes(1);
    // the read wrappers take no body/args (pure GETs)
    expect(h.xp).toHaveBeenCalledWith();
    expect(h.izl).toHaveBeenCalledWith();
  });

  it('WEB-PROG-20 overall progress reflects real V2 acquisition (2 of 4 acquired), not-yet-acquired points are not counted', async () => {
    renderPage();
    // 2 acquired (learned + validated) of 4 → the honest count, never inflated by unacquired points
    expect(await screen.findByText('Bajarildi: 2/4')).toBeInTheDocument();
    expect(screen.queryByText('Hozircha progress yo‘q')).toBeNull();
  });

  it('WEB-PROG-21 areas needing attention surface acquired points with a real repair/review signal', async () => {
    h.roadmap.mockResolvedValue({
      generation: { id: 'g1', subjectId: 's1', trackId: 't1', generationNo: 1, generatedAt: 'x' },
      points: [
        pt({ roadmapPointId: 'p1', title: 'Weak point', learned: true, acquisition: 'LEARNED', attention: 'REPAIR_REQUIRED', attentionReason: 'REPEATED_MISTAKE', attentionSkill: { id: 'skX', name: 'Word order' } }),
        pt({ roadmapPointId: 'p2', title: 'Fresh point', learned: true, acquisition: 'LEARNED' }),
      ],
    });
    renderPage();
    expect(await screen.findByText('E’tibor talab qiladi')).toBeInTheDocument();
    expect(screen.getByText('Weak point')).toBeInTheDocument();
    expect(screen.getByText('Mustahkamlash kerak')).toBeInTheDocument(); // repair badge
    // routes into the roadmap, and never leaks engine codes / raw ids
    expect(screen.getAllByRole('link', { name: 'Mustahkamlash' })[0]).toHaveAttribute('href', '/learn/roadmap');
    expect(document.body.textContent).not.toContain('REPEATED_MISTAKE');
    expect(document.body.textContent).not.toContain('skX');
  });
});
