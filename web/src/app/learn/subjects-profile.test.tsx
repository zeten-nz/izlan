import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { ToastProvider } from '@/components/ui/toast';
import SubjectsPage from './subjects/page';
import ProfilePage from './profile/page';

const h = vi.hoisted(() => ({
  replace: vi.fn(), logout: vi.fn(),
  fetchProfile: vi.fn(), updateProfile: vi.fn(),
  fetchIntents: vi.fn(), fetchSubjects: vi.fn(), fetchTracks: vi.fn(), saveIntent: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: h.replace, push: vi.fn() }) }));
vi.mock('@/lib/auth/auth-context', () => ({ useAuth: () => ({ logout: h.logout }) }));
vi.mock('@/lib/api/profile', () => ({ fetchProfile: h.fetchProfile, updateProfile: h.updateProfile }));
vi.mock('@/lib/api/onboarding', () => ({ fetchLearningIntents: h.fetchIntents, fetchOnboardingSubjects: h.fetchSubjects, fetchOnboardingTracks: h.fetchTracks, saveLearningIntent: h.saveIntent }));

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider><I18nProvider><ToastProvider>{ui}</ToastProvider></I18nProvider></ThemeProvider>);
}

const intentWithTrack = { id: 'i1', subject: { id: 's1', slug: 'english', title: 'English' }, track: { id: 't1', slug: 'general', title: 'General English' } };
const SUBJECT2 = { id: 's2', slug: 'math', title: 'Math', description: null };

describe('Learner subjects (WEB-SUB)', () => {
  beforeEach(() => { Object.values(h).forEach((f) => f.mockReset()); });

  it('WEB-SUB-01/03 current intents render; only backend subjects are shown (nothing fabricated)', async () => {
    h.fetchIntents.mockResolvedValue([intentWithTrack]);
    h.fetchSubjects.mockResolvedValue([{ id: 's1', slug: 'english', title: 'English', description: null }, SUBJECT2]);
    wrap(<SubjectsPage />);
    await waitFor(() => expect(screen.getByText('General English')).toBeInTheDocument());
    expect(screen.getByText('Math')).toBeInTheDocument(); // available (not yet chosen)
    // no fabricated subject beyond what the API returned
    expect(screen.queryByText('Physics')).toBeNull();
  });

  it('WEB-SUB-02 adding a subject uses the backend learning-intent authority', async () => {
    h.fetchIntents.mockResolvedValue([]);
    h.fetchSubjects.mockResolvedValue([SUBJECT2]);
    h.saveIntent.mockResolvedValue([{ id: 'i2', subject: { id: 's2', slug: 'math', title: 'Math' }, track: null }]);
    h.fetchTracks.mockResolvedValue([]);
    wrap(<SubjectsPage />);
    await waitFor(() => expect(screen.getByText('Math')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Qo‘shish' }));
    await waitFor(() => expect(h.saveIntent).toHaveBeenCalledWith('s2'));
  });
});

describe('Learner profile (WEB-PROFILE)', () => {
  beforeEach(() => { Object.values(h).forEach((f) => f.mockReset()); });

  const profile = (over = {}) => ({ id: 'user-internal-id-123', displayName: 'Ali', dateOfBirth: '2005-01-02', timezone: 'Asia/Tashkent', preferredLanguage: 'uz', onboarding: { completed: true, completedAt: 'x' }, ...over });

  it('WEB-PROFILE-01/03 safe fields render; roles/internal ids are never shown', async () => {
    h.fetchProfile.mockResolvedValue(profile());
    wrap(<ProfilePage />);
    await waitFor(() => expect(screen.getByLabelText('Ism')).toHaveValue('Ali'));
    expect(screen.getByLabelText('Tug‘ilgan sana')).toHaveValue('2005-01-02');
    expect(document.body.textContent).not.toContain('user-internal-id-123');
    expect(document.body.textContent).not.toMatch(/LEARNER|permission/);
  });

  it('WEB-PROFILE-02 saving uses PATCH /profile/me (DOB omitted when locked)', async () => {
    h.fetchProfile.mockResolvedValue(profile());
    h.updateProfile.mockResolvedValue(profile());
    wrap(<ProfilePage />);
    await waitFor(() => expect(screen.getByLabelText('Ism')).toHaveValue('Ali'));
    // DOB is locked after onboarding — the input is disabled
    expect(screen.getByLabelText('Tug‘ilgan sana')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Saqlash' }));
    await waitFor(() => expect(h.updateProfile).toHaveBeenCalled());
    const arg = h.updateProfile.mock.calls[0]![0];
    expect(arg).not.toHaveProperty('dateOfBirth'); // no DOB mutation the backend would reject
    expect(arg).toMatchObject({ displayName: 'Ali', preferredLanguage: 'uz' });
  });

  it('WEB-PROFILE-04 logout clears in-memory auth and routes to /login', async () => {
    h.fetchProfile.mockResolvedValue(profile());
    h.logout.mockResolvedValue(undefined);
    wrap(<ProfilePage />);
    await waitFor(() => expect(screen.getByLabelText('Ism')).toHaveValue('Ali'));
    fireEvent.click(screen.getByRole('button', { name: 'Chiqish' }));
    await waitFor(() => expect(h.logout).toHaveBeenCalled());
    expect(h.replace).toHaveBeenCalledWith('/login');
  });
});
