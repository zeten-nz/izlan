import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { ApiError, NetworkError } from '@/lib/api/errors';
import OnboardingPage from './page';

const h = vi.hoisted(() => ({
  replace: vi.fn(), setUser: vi.fn(),
  fetchProfile: vi.fn(), updateProfile: vi.fn(),
  fetchStatus: vi.fn(), fetchSubjects: vi.fn(), fetchTracks: vi.fn(), fetchIntents: vi.fn(),
  saveIntent: vi.fn(), complete: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: h.replace, push: vi.fn() }) }));
vi.mock('@/lib/auth/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1', onboardingCompleted: false }, setAuthenticatedUser: h.setUser }) }));
vi.mock('@/lib/api/profile', () => ({ fetchProfile: h.fetchProfile, updateProfile: h.updateProfile }));
vi.mock('@/lib/api/onboarding', () => ({
  fetchOnboardingStatus: h.fetchStatus, fetchOnboardingSubjects: h.fetchSubjects, fetchOnboardingTracks: h.fetchTracks,
  fetchLearningIntents: h.fetchIntents, saveLearningIntent: h.saveIntent, completeOnboarding: h.complete,
}));

const profile = (over = {}) => ({ id: 'u1', displayName: null, dateOfBirth: null, timezone: 'Asia/Tashkent', preferredLanguage: 'uz', onboarding: { completed: false, completedAt: null }, ...over });
const SUBJECT = { id: 's1', slug: 'english', title: 'English', description: null };
const TRACK = { id: 't1', slug: 'general', title: 'General English', description: null };
const intent = (over = {}) => ({ id: 'i1', subject: { id: 's1', slug: 'english', title: 'English' }, track: null, ...over });

function setup(cfg: { profile?: object; missing?: string[]; completed?: boolean; canComplete?: boolean; subjects?: object[]; intents?: object[] } = {}) {
  h.fetchProfile.mockResolvedValue(cfg.profile ?? profile());
  h.fetchStatus.mockResolvedValue({ completed: cfg.completed ?? false, canComplete: cfg.canComplete ?? false, missing: cfg.missing ?? [] });
  h.fetchSubjects.mockResolvedValue(cfg.subjects ?? [SUBJECT]);
  h.fetchIntents.mockResolvedValue(cfg.intents ?? []);
  h.fetchTracks.mockResolvedValue([TRACK]);
  return render(<ThemeProvider><I18nProvider><OnboardingPage /></I18nProvider></ThemeProvider>);
}

describe('Learner onboarding (WEB-ONB)', () => {
  beforeEach(() => { Object.values(h).forEach((f) => f.mockReset()); });

  it('WEB-ONB-01 an incomplete backend state shows the Profile stage', async () => {
    setup({ missing: ['displayName', 'dateOfBirth'] });
    await waitFor(() => expect(screen.getByText('Sizni yaxshiroq tanib olaylik')).toBeInTheDocument());
  });

  it('WEB-ONB-02 profile fields hydrate from GET /profile/me', async () => {
    setup({ profile: profile({ displayName: 'Ali', dateOfBirth: '2005-01-02' }), missing: ['timezone'] });
    await waitFor(() => expect(screen.getByLabelText('Ismingiz')).toHaveValue('Ali'));
  });

  it('WEB-ONB-03 profile save calls PATCH /profile/me and advances to the intent stage', async () => {
    h.updateProfile.mockResolvedValue(profile({ displayName: 'Ali' }));
    setup({ profile: profile({ displayName: 'Ali', dateOfBirth: '2005-01-02' }), missing: ['timezone'] });
    await waitFor(() => expect(screen.getByText('Sizni yaxshiroq tanib olaylik')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Davom etish' }));
    await waitFor(() => expect(h.updateProfile).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Nimani o‘rganmoqchisiz?')).toBeInTheDocument());
  });

  it('WEB-ONB-04 published subjects render on the intent stage', async () => {
    setup({ subjects: [SUBJECT], intents: [] }); // profile complete (missing []) → intent stage
    await waitFor(() => expect(screen.getByRole('radio', { name: 'English' })).toBeInTheDocument());
  });

  it('WEB-ONB-05 zero subjects produces an intentional empty state (no fabricated fallback)', async () => {
    setup({ subjects: [], intents: [] });
    await waitFor(() => expect(screen.getByText('Hozircha o‘rganish uchun ochiq fan mavjud emas.')).toBeInTheDocument());
  });

  it('WEB-ONB-06 selecting a subject saves a subject-only intent', async () => {
    h.saveIntent.mockResolvedValue([intent()]);
    setup({ subjects: [SUBJECT], intents: [] });
    await waitFor(() => expect(screen.getByRole('radio', { name: 'English' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('radio', { name: 'English' }));
    await waitFor(() => expect(h.saveIntent).toHaveBeenCalledWith('s1'));
  });

  it('WEB-ONB-07/08 tracks load for the selected subject and picking one persists a complete intent', async () => {
    h.saveIntent.mockResolvedValue([intent({ track: { id: 't1', slug: 'general', title: 'General English' } })]);
    setup({ intents: [intent()] }); // subject set (s1), no track → intent stage, subject preselected
    await waitFor(() => expect(h.fetchTracks).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'General English' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('radio', { name: 'General English' }));
    await waitFor(() => expect(h.saveIntent).toHaveBeenCalledWith('s1', 't1'));
  });

  it('WEB-ONB-09 cannot complete until backend canComplete=true', async () => {
    h.fetchStatus.mockResolvedValueOnce({ completed: false, canComplete: true, missing: [] }); // init → intent stage
    h.fetchStatus.mockResolvedValueOnce({ completed: false, canComplete: false, missing: ['learningIntent'] }); // finish re-check
    h.fetchProfile.mockResolvedValue(profile({ displayName: 'Ali' }));
    h.fetchSubjects.mockResolvedValue([SUBJECT]);
    h.fetchIntents.mockResolvedValue([intent({ track: { id: 't1', slug: 'general', title: 'General English' } })]);
    h.fetchTracks.mockResolvedValue([TRACK]);
    render(<ThemeProvider><I18nProvider><OnboardingPage /></I18nProvider></ThemeProvider>);
    await waitFor(() => expect(screen.getByText('Nimani o‘rganmoqchisiz?')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Davom etish' }));
    await waitFor(() => expect(h.fetchStatus).toHaveBeenCalledTimes(2));
    expect(h.complete).not.toHaveBeenCalled();
  });

  it('WEB-ONB-10 completing onboarding redirects to /learn', async () => {
    h.complete.mockResolvedValue({ completed: true, completedAt: '2026-01-01T00:00:00Z' });
    h.fetchStatus.mockResolvedValueOnce({ completed: false, canComplete: true, missing: [] });
    h.fetchStatus.mockResolvedValueOnce({ completed: false, canComplete: true, missing: [] });
    h.fetchProfile.mockResolvedValue(profile({ displayName: 'Ali' }));
    h.fetchSubjects.mockResolvedValue([SUBJECT]);
    h.fetchIntents.mockResolvedValue([intent({ track: { id: 't1', slug: 'general', title: 'General English' } })]);
    h.fetchTracks.mockResolvedValue([TRACK]);
    render(<ThemeProvider><I18nProvider><OnboardingPage /></I18nProvider></ThemeProvider>);
    await waitFor(() => expect(screen.getByText('Nimani o‘rganmoqchisiz?')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Davom etish' }));
    await waitFor(() => expect(h.complete).toHaveBeenCalled());
    expect(h.replace).toHaveBeenCalledWith('/learn');
  });

  it('WEB-ONB-11 already-completed onboarding redirects to /learn (resumes from backend, not local state)', async () => {
    setup({ completed: true, canComplete: true, intents: [intent({ track: { id: 't1', slug: 'general', title: 'General English' } })], profile: profile({ displayName: 'Ali', onboarding: { completed: true, completedAt: '2026-01-01T00:00:00Z' } }) });
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/learn'));
  });

  it('WEB-ONB-12 the actually selected track is shown as selected and saved with the real selection', async () => {
    h.saveIntent.mockResolvedValue([intent({ track: { id: 't1', slug: 'general', title: 'General English' } })]);
    setup({ subjects: [SUBJECT], intents: [] });
    fireEvent.click(await screen.findByRole('radio', { name: 'English' }));
    await waitFor(() => expect(h.saveIntent).toHaveBeenCalledWith('s1')); // subject-only first
    fireEvent.click(await screen.findByRole('radio', { name: 'General English' }));
    await waitFor(() => expect(h.saveIntent).toHaveBeenCalledWith('s1', 't1')); // real selection saved
    expect(screen.getByRole('radio', { name: 'General English' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Davom etish' })).toBeEnabled();
  });

  it('WEB-ONB-13 choosing a different track shows and saves the NEW track (not the old intent track)', async () => {
    h.fetchProfile.mockResolvedValue(profile({ displayName: 'Ali' }));
    h.fetchStatus.mockResolvedValue({ completed: false, canComplete: false, missing: [] });
    h.fetchSubjects.mockResolvedValue([SUBJECT]);
    h.fetchIntents.mockResolvedValue([intent({ track: { id: 'tA', slug: 'a', title: 'Track A' } })]);
    h.fetchTracks.mockResolvedValue([{ id: 'tA', slug: 'a', title: 'Track A', description: null }, { id: 'tB', slug: 'b', title: 'Track B', description: null }]);
    h.saveIntent.mockResolvedValue([intent({ track: { id: 'tB', slug: 'b', title: 'Track B' } })]);
    render(<ThemeProvider><I18nProvider><OnboardingPage /></I18nProvider></ThemeProvider>);
    expect(await screen.findByRole('radio', { name: 'Track A' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Track B' }));
    await waitFor(() => expect(h.saveIntent).toHaveBeenCalledWith('s1', 'tB'));
    expect(screen.getByRole('radio', { name: 'Track B' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Track A' })).not.toBeChecked();
  });

  it('WEB-ONB-14 switching subject clears the previously selected track (no leak across subjects)', async () => {
    h.fetchProfile.mockResolvedValue(profile({ displayName: 'Ali' }));
    h.fetchStatus.mockResolvedValue({ completed: false, canComplete: false, missing: [] });
    h.fetchSubjects.mockResolvedValue([SUBJECT, { id: 's2', slug: 'math', title: 'Math', description: null }]);
    h.fetchIntents.mockResolvedValue([]);
    h.saveIntent.mockResolvedValue([intent()]);
    h.fetchTracks.mockImplementation((sid: string) => Promise.resolve(sid === 's2'
      ? [{ id: 't2', slug: 'algebra', title: 'Algebra', description: null }]
      : [{ id: 't1', slug: 'general', title: 'General English', description: null }]));
    render(<ThemeProvider><I18nProvider><OnboardingPage /></I18nProvider></ThemeProvider>);
    fireEvent.click(await screen.findByRole('radio', { name: 'English' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'General English' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'General English' })).toBeChecked());
    // switch subject → the incompatible track must be cleared and completion blocked
    fireEvent.click(screen.getByRole('radio', { name: 'Math' }));
    await waitFor(() => expect(h.fetchTracks).toHaveBeenCalledWith('s2'));
    expect(await screen.findByRole('radio', { name: 'Algebra' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'General English' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Davom etish' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Algebra' }));
    await waitFor(() => expect(h.saveIntent).toHaveBeenCalledWith('s2', 't2'));
    expect(screen.getByRole('radio', { name: 'Algebra' })).toBeChecked();
  });

  it('WEB-ONB-15 subject and track selections are accessible single-choice radio groups', async () => {
    setup({ intents: [intent()] }); // subject preselected → both groups present
    expect(await screen.findByRole('radiogroup', { name: 'Fan' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'English' })).toBeChecked();
    await waitFor(() => expect(screen.getByRole('radio', { name: 'General English' })).toBeInTheDocument());
  });

  it('WEB-ONB-16 a failed initial load surfaces the real classified error, never a false network banner', async () => {
    h.fetchProfile.mockRejectedValue(new ApiError(500, 'SOME_SERVER_CODE', 'boom'));
    h.fetchStatus.mockResolvedValue({ completed: false, canComplete: false, missing: [] });
    h.fetchSubjects.mockResolvedValue([]);
    h.fetchIntents.mockResolvedValue([]);
    render(<ThemeProvider><I18nProvider><OnboardingPage /></I18nProvider></ThemeProvider>);
    await waitFor(() => expect(screen.getByText(/Kutilmagan xatolik/)).toBeInTheDocument());
    expect(screen.queryByText(/Server bilan bog/)).toBeNull(); // NOT falsely "couldn't reach the server"
    expect(document.body.textContent).not.toContain('SOME_SERVER_CODE');
  });

  it('WEB-ONB-17 a genuine transport failure on load shows the network message', async () => {
    h.fetchProfile.mockResolvedValue(profile());
    h.fetchStatus.mockRejectedValue(new NetworkError());
    h.fetchSubjects.mockResolvedValue([]);
    h.fetchIntents.mockResolvedValue([]);
    render(<ThemeProvider><I18nProvider><OnboardingPage /></I18nProvider></ThemeProvider>);
    await waitFor(() => expect(screen.getByText(/Server bilan bog/)).toBeInTheDocument());
  });
});
