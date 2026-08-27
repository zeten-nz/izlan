import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { ToastProvider } from '@/components/ui';

// Controllable capabilities (components read useCapabilities()).
const capsRef = vi.hoisted(() => ({ current: { author: true, publish: true, subjectManage: false } }));
vi.mock('@/lib/cms/cms-context', () => ({
  useCapabilities: () => capsRef.current,
  useCms: () => ({ status: 'ready', session: null, capabilities: capsRef.current, reload: () => {} }),
}));

// Mock the whole staff assessments API.
const api = vi.hoisted(() => ({
  getSubjectAssessments: vi.fn(), getAssessmentDefinition: vi.fn(), getAssessmentVersion: vi.fn(),
  getAssessmentReadiness: vi.fn(), getAssessmentPreview: vi.fn(),
  ensureAssessmentDefinition: vi.fn(), updateAssessmentDefinition: vi.fn(),
  createAssessmentVersion: vi.fn(), updateAssessmentConfig: vi.fn(),
  createAssessmentItem: vi.fn(), updateAssessmentItem: vi.fn(), deleteAssessmentItem: vi.fn(), reorderAssessmentItems: vi.fn(),
  submitAssessmentReview: vi.fn(), returnAssessmentToDraft: vi.fn(), publishAssessmentVersion: vi.fn(),
}));
vi.mock('@/lib/api/assessments', () => api);

import { AssessmentReadinessPanel } from './AssessmentReadinessPanel';
import { AssessmentPreview } from './AssessmentPreview';
import { AssessmentQuestionEditor } from './AssessmentQuestionEditor';
import { AssessmentWorkflowActions } from './AssessmentWorkflowActions';
import { AssessmentVersionList } from './AssessmentVersionList';
import type { Skill } from '@/lib/api/types';

const wrap = (ui: ReactNode) => (
  <ThemeProvider><I18nProvider><ToastProvider>{ui}</ToastProvider></I18nProvider></ThemeProvider>
);

const skill = (id: string, name: string, status: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE'): Skill => ({
  id, subjectId: 'sub', name, code: null, description: null, status, sortOrder: 0, createdAt: '', updatedAt: '',
});
const CONFIG = { itemsPerSkill: 1, maxItems: 10, startDifficulty: 3, system: { stepUp: 1, stepDown: 1, minDifficulty: 1, maxDifficulty: 6 } };
const detailStub = { version: { id: 'v1', versionNo: 1, status: 'DRAFT', isCurrent: false, publishedAt: null, updatedAt: 'T2' }, config: CONFIG, items: [] };

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  capsRef.current = { author: true, publish: true, subjectManage: false };
});

describe('Assessment Builder (AB)', () => {
  it('AB-01 readiness: an uncovered active skill is a WARNING; a shortage is a BLOCKER', async () => {
    api.getAssessmentReadiness.mockResolvedValue({
      publishReady: false,
      checks: { hasItems: true, allPayloadsValid: true, allObjective: true, optionsWellFormed: true, allSkillsActiveAndSameSubject: true, difficultyInScale: true, configValid: true, coveredSkillsMeetItemsPerSkill: false, maxItemsCanCoverIncludedSkills: true },
      coverage: { activeSubjectSkillIds: ['s1', 's2'], coveredSkillIds: ['s1'], uncoveredSkillIds: ['s2'], itemsPerSkill: { s1: 1 }, requiredItemsPerSkill: 2 },
      blockers: [{ code: 'INSUFFICIENT_ITEMS_FOR_COVERED_SKILL', skillId: 's1' }],
      warnings: [{ code: 'UNCOVERED_ACTIVE_SKILL', skillId: 's2' }],
    });
    render(wrap(<AssessmentReadinessPanel versionId="v1" reloadKey="k" skills={[skill('s1', 'Greetings'), skill('s2', 'Numbers')]} />));
    // blocker (with skill name) + warning (with skill name) both render, in their own sections
    expect(await screen.findByText(/yetarli emas — Greetings/)).toBeInTheDocument(); // blocker, with skill name
    expect(screen.getByText(/Qamrab olinmagan faol/)).toBeInTheDocument(); // warning (uncovered active skill)
    expect(screen.getAllByText(/Numbers/).length).toBeGreaterThan(0); // uncovered skill named
    expect(screen.getByText(/Tayyor emas/)).toBeInTheDocument(); // not publish-ready
  });

  it('AB-02 preview renders learner-safe items — prompt + options, never an answer key', async () => {
    api.getAssessmentPreview.mockResolvedValue({
      versionId: 'v1',
      items: [{ id: 'i1', type: 'MINI_QUESTION', format: 'single_choice', prompt: 'Which greeting?', options: [{ id: 'a', text: 'Good morning' }, { id: 'b', text: 'Good night' }] }],
    });
    render(wrap(<AssessmentPreview versionId="v1" reloadKey="k" />));
    expect(await screen.findByText('Which greeting?')).toBeInTheDocument();
    expect(screen.getByText('Good morning')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('answerKey');
    expect(document.body.textContent).not.toContain('correctOptionIds');
  });

  it('AB-03 question editor shows the answer key (staff mode) and saves the reconstructed payload', async () => {
    api.updateAssessmentItem.mockResolvedValue(detailStub);
    const item = { id: 'i1', format: 'single_choice' as const, prompt: 'Q?', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], answerKey: { correctOptionIds: ['a'] }, skillId: 's1', difficulty: 3, ordering: 0, updatedAt: 'IT' };
    render(wrap(<AssessmentQuestionEditor open onClose={() => {}} versionId="v1" versionUpdatedAt="VT" item={item} skills={[skill('s1', 'Greetings')]} config={CONFIG} onSaved={() => {}} />));
    const radios = screen.getAllByRole('radio');
    expect(radios[0]).toBeChecked(); // answerKey visible: option A marked correct
    expect(radios[1]).not.toBeChecked();
    const save = screen.getByRole('button', { name: 'Saqlash' });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    await waitFor(() => expect(api.updateAssessmentItem).toHaveBeenCalled());
    expect(api.updateAssessmentItem).toHaveBeenCalledWith('i1', expect.objectContaining({ expectedItemUpdatedAt: 'IT', format: 'single_choice', prompt: 'Q?', correctOptionIds: ['a'], skillId: 's1', difficulty: 3 }));
  });

  it('AB-04 question editor blocks Save until valid (empty create form)', () => {
    render(wrap(<AssessmentQuestionEditor open onClose={() => {}} versionId="v1" versionUpdatedAt="VT" skills={[skill('s1', 'Greetings')]} config={CONFIG} onSaved={() => {}} />));
    expect(screen.getByRole('button', { name: 'Saqlash' })).toBeDisabled(); // no prompt / no option text / no skill
  });

  it('AB-05 workflow: DRAFT shows submit for an author; REVIEW hides publish without publish rights', () => {
    capsRef.current = { author: true, publish: false, subjectManage: false };
    const { rerender } = render(wrap(<AssessmentWorkflowActions version={{ id: 'v1', status: 'DRAFT', updatedAt: 'T' }} onChanged={() => {}} />));
    expect(screen.getByRole('button', { name: /yuborish/ })).toBeInTheDocument(); // submit for review
    rerender(wrap(<AssessmentWorkflowActions version={{ id: 'v1', status: 'REVIEW', updatedAt: 'T' }} onChanged={() => {}} />));
    expect(screen.queryByRole('button', { name: 'Nashr qilish' })).toBeNull(); // no publish button
    expect(screen.getByText(/huquqi yo/)).toBeInTheDocument(); // "no publish right"
  });

  it('AB-06 workflow: REVIEW shows publish + return for a publisher', () => {
    capsRef.current = { author: true, publish: true, subjectManage: false };
    render(wrap(<AssessmentWorkflowActions version={{ id: 'v1', status: 'REVIEW', updatedAt: 'T' }} onChanged={() => {}} />));
    expect(screen.getByRole('button', { name: 'Nashr qilish' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /qaytarish/ })).toBeInTheDocument();
  });

  it('AB-07 version list: only one editable version — create disabled while a DRAFT exists', () => {
    const def = { id: 'd1', subjectId: 's', purposeScope: 'DIAGNOSTIC', title: 'T', description: null, status: 'PUBLISHED' as const, currentVersionId: 'v1', updatedAt: 'T' };
    const versions = [
      { id: 'v1', versionNo: 1, status: 'PUBLISHED' as const, isCurrent: true, publishedAt: null, updatedAt: 'T', itemCount: 3 },
      { id: 'v2', versionNo: 2, status: 'DRAFT' as const, isCurrent: false, publishedAt: null, updatedAt: 'T', itemCount: 0 },
    ];
    render(wrap(<AssessmentVersionList definition={def} versions={versions} selectedVersionId="v2" onSelect={() => {}} onCreated={() => {}} />));
    expect(screen.getByText(/versiya bor/)).toBeInTheDocument(); // editableExists notice
    expect(screen.queryByRole('button', { name: /Bo.sh versiya/ })).toBeNull(); // create hidden
  });

  it('AB-08 version list: create enabled when none editable; clone disabled without a current version', () => {
    const def = { id: 'd1', subjectId: 's', purposeScope: 'DIAGNOSTIC', title: 'T', description: null, status: 'DRAFT' as const, currentVersionId: null, updatedAt: 'T' };
    render(wrap(<AssessmentVersionList definition={def} versions={[]} selectedVersionId={null} onSelect={() => {}} onCreated={() => {}} />));
    expect(screen.getByRole('button', { name: /Bo.sh versiya/ })).toBeEnabled(); // blank allowed
    expect(screen.getByRole('button', { name: /nusxa/ })).toBeDisabled(); // clone needs a current published version
  });
});
