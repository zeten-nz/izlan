import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { ToastProvider } from '@/components/ui/toast';
import PointEditorPage from './[pointId]/page';

const caps = vi.hoisted(() => ({ current: { author: true, publish: true, subjectManage: false } }));
vi.mock('@/lib/cms/cms-context', () => ({
  useCapabilities: () => caps.current,
  useCms: () => ({ status: 'ready', session: null, capabilities: caps.current, reload: () => {} }),
}));
const h = vi.hoisted(() => ({ getPoint: vi.fn(), getPointReadiness: vi.fn(), submitPointReview: vi.fn(), reviewPoint: vi.fn(), publishPoint: vi.fn(), listSubjectSkills: vi.fn(), listBindableActivities: vi.fn(), revisePoint: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ pointId: 'pt1' }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/api/point-studio', () => h);

const detail = (over: Record<string, unknown> = {}) => ({
  point: { id: 'pt1', pointKey: 'ENG-A1-VERB-BE', status: 'DRAFT', levelId: 'lv1', levelCode: 'A1', subjectId: 's1', trackTitle: 'General', publishedRevisionId: null },
  revision: { id: 'rev1', versionNo: 1, status: 'DRAFT', title: 'To be', canDo: ['am/is/are'], sortOrderDefault: 20, estimatedEffortMin: 20, updatedAt: 't0', editable: true },
  skills: [{ skillId: 'sk1', skillName: 'BE-AFFIRMATIVE', skillCode: 'BE', role: 'REQUIRED', expectationId: 'e1' }],
  prerequisites: [],
  blueprint: { id: 'bp1', status: 'DRAFT', revision: { id: 'bpr1', versionNo: 1, status: 'DRAFT', updatedAt: 't0', editable: true, stages: [] } },
  mastery: { id: 'mr1', status: 'DRAFT', revision: { id: 'mrr1', versionNo: 1, status: 'DRAFT', policyVersion: 'v1', updatedAt: 't0', editable: true, gates: {}, skillGates: [] } },
  sources: [],
  issues: [],
  ...over,
});

function renderPage() {
  return render(<ThemeProvider><I18nProvider><ToastProvider><PointEditorPage /></ToastProvider></I18nProvider></ThemeProvider>);
}

describe('Point Studio editor (WEB-PS)', () => {
  beforeEach(() => {
    Object.values(h).forEach((f) => f.mockReset());
    caps.current = { author: true, publish: true, subjectManage: false };
    h.listSubjectSkills.mockResolvedValue([]);
    h.listBindableActivities.mockResolvedValue([]);
  });

  it('WEB-PS-01: a DRAFT point shows sections + a submit-for-review action; readiness blockers are localized', async () => {
    h.getPoint.mockResolvedValue(detail());
    h.getPointReadiness.mockResolvedValue({ pointId: 'pt1', reviewReady: false, publishReady: false, blockers: [{ code: 'MASTERY_NO_GATE', scope: 'mastery' }], warnings: [] });
    renderPage();
    expect(await screen.findByText('Umumiy')).toBeInTheDocument(); // metadata section
    expect(screen.getByText('O‘qitish rejasi')).toBeInTheDocument(); // blueprint section
    expect(screen.getByRole('button', { name: 'Ko‘rikka yuborish' })).toBeInTheDocument();
    // blocker rendered in learner-language (not the raw code)
    expect(await screen.findByText(/O‘zlashtirish talabi bo‘sh/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('MASTERY_NO_GATE');
  });

  it('WEB-PS-02: publish is disabled until publish-ready; approve + publish require the publish capability', async () => {
    h.getPoint.mockResolvedValue(detail({ revision: { id: 'rev1', versionNo: 1, status: 'REVIEW', title: 'To be', canDo: ['x'], sortOrderDefault: 20, estimatedEffortMin: 20, updatedAt: 't0', editable: false } }));
    h.getPointReadiness.mockResolvedValue({ pointId: 'pt1', reviewReady: true, publishReady: false, blockers: [{ code: 'REVIEW_REQUIRED', scope: 'point' }], warnings: [] });
    const first = renderPage();
    expect(await screen.findByRole('button', { name: 'Tasdiqlash' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nashr qilish' })).toBeDisabled();
    first.unmount();

    // Without publish capability, review/publish actions are hidden.
    caps.current = { author: true, publish: false, subjectManage: false };
    h.getPoint.mockResolvedValue(detail({ revision: { id: 'rev1', versionNo: 1, status: 'REVIEW', title: 'To be', canDo: ['x'], sortOrderDefault: 20, estimatedEffortMin: 20, updatedAt: 't0', editable: false } }));
    renderPage();
    await screen.findByText('Umumiy');
    expect(screen.queryByRole('button', { name: 'Tasdiqlash' })).toBeNull();
  });

  it('WEB-PS-03: a publish-ready REVIEW point publishes on confirm', async () => {
    h.getPoint.mockResolvedValue(detail({ revision: { id: 'rev1', versionNo: 1, status: 'REVIEW', title: 'To be', canDo: ['x'], sortOrderDefault: 20, estimatedEffortMin: 20, updatedAt: 't0', editable: false } }));
    h.getPointReadiness.mockResolvedValue({ pointId: 'pt1', reviewReady: true, publishReady: true, blockers: [], warnings: [] });
    h.publishPoint.mockResolvedValue(detail({ point: { id: 'pt1', pointKey: 'ENG-A1-VERB-BE', status: 'PUBLISHED', levelId: 'lv1', levelCode: 'A1', subjectId: 's1', trackTitle: 'General', publishedRevisionId: 'rev1' }, revision: { id: 'rev1', versionNo: 1, status: 'PUBLISHED', title: 'To be', canDo: ['x'], sortOrderDefault: 20, estimatedEffortMin: 20, updatedAt: 't1', editable: false } }));
    renderPage();
    // wait for readiness to load → publish enabled
    await waitFor(() => expect(screen.getByRole('button', { name: 'Nashr qilish' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Nashr qilish' }));
    // confirm dialog → its confirm button
    const confirm = await screen.findAllByRole('button', { name: 'Nashr qilish' });
    fireEvent.click(confirm[confirm.length - 1]!);
    await waitFor(() => expect(h.publishPoint).toHaveBeenCalledWith('rev1', { expectedUpdatedAt: 't0' }));
  });
});
