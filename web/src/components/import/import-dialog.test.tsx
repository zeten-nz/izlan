import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { I18nProvider, useI18n } from '@/lib/i18n/i18n-context';
import { ApiError } from '@/lib/api/errors';
import type { ImportValidateResponse } from '@/lib/api/types';
import { ImportDialog } from './ImportDialog';

const h = vi.hoisted(() => ({ validate: vi.fn(), apply: vi.fn(), imported: vi.fn() }));
vi.mock('@/lib/api/content', () => ({ validateImport: h.validate, applyImport: h.apply }));
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

const SECRET = 'SECRET-ANSWER-KEY-xyz';
const SUMMARY = { skillsToCreate: 1, skillsReused: 2, lessonsToCreate: 7, revisionsToCreate: 7, activitiesToCreate: 9, lessonSkillMappings: 4, activitySkillMappings: 8, prerequisitesToCreate: 5 };
const okResult: ImportValidateResponse = { schemaVersion: 'izlan-topic-content/v1', documentHash: 'a'.repeat(64), valid: true, summary: SUMMARY, errors: [], warnings: [] };

function Harness() {
  const { setLocale } = useI18n();
  return (
    <>
      <button onClick={() => setLocale('ru')}>to-ru</button>
      <button onClick={() => setLocale('en')}>to-en</button>
      <ImportDialog topicId="topic-1" open onClose={() => {}} onImported={h.imported} />
    </>
  );
}
function renderDialog() {
  return render(
    <I18nProvider>
      <Harness />
    </I18nProvider>,
  );
}

function fileOf(content: string, name = 'data.json', size?: number) {
  const f = new File([content], name, { type: 'application/json' });
  if (size !== undefined) Object.defineProperty(f, 'size', { value: size });
  return f;
}
async function loadFile(content: string, name = 'data.json', size?: number) {
  fireEvent.change(screen.getByLabelText('Fayl tanlash'), { target: { files: [fileOf(content, name, size)] } });
}

const VALID_DOC = JSON.stringify({ schemaVersion: 'izlan-topic-content/v1', lessons: [] });

describe('Bulk import dialog (WEB-IMP, TD-253)', () => {
  beforeEach(() => {
    h.validate.mockReset();
    h.apply.mockReset();
    h.imported.mockReset();
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
  });

  it('WEB-IMP-01 only JSON is accepted', async () => {
    renderDialog();
    expect(screen.getByLabelText('Fayl tanlash').getAttribute('accept')).toContain('json');
    await loadFile('irrelevant', 'notes.txt');
    await waitFor(() => expect(screen.getByText('Faqat .json fayl qabul qilinadi.')).toBeInTheDocument());
    expect(h.validate).not.toHaveBeenCalled();
  });

  it('WEB-IMP-02 oversized file rejected client-side (no server call)', async () => {
    renderDialog();
    await loadFile('{}', 'big.json', 5 * 1024 * 1024 + 1);
    await waitFor(() => expect(screen.getByText('Fayl juda katta (maksimum 5 MB).')).toBeInTheDocument());
    expect(h.validate).not.toHaveBeenCalled();
  });

  it('WEB-IMP-03 malformed JSON produces a safe local error (no server call)', async () => {
    renderDialog();
    await loadFile('{ not json', 'bad.json');
    await waitFor(() => expect(screen.getByText('JSON faylni o‘qib bo‘lmadi.')).toBeInTheDocument());
    expect(h.validate).not.toHaveBeenCalled();
  });

  it('WEB-IMP-04 validate summary renders counts', async () => {
    h.validate.mockResolvedValue(okResult);
    renderDialog();
    await loadFile(VALID_DOC);
    await waitFor(() => expect(screen.getByText('data.json')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Tekshirish' }));
    await waitFor(() => expect(screen.getByText('Yaroqli')).toBeInTheDocument());
    expect(screen.getByText('7')).toBeInTheDocument(); // lessons
    expect(screen.getByText('9')).toBeInTheDocument(); // activities
  });

  it('WEB-IMP-05/06 validation errors render localized messages; apply disabled when invalid', async () => {
    h.validate.mockResolvedValue({ ...okResult, valid: false, errors: [{ code: 'IMPORT_ACTIVITY_PAYLOAD_INVALID', path: 'lessons[0].revision.activities[1].payload' }] });
    renderDialog();
    await loadFile(VALID_DOC);
    await waitFor(() => expect(screen.getByText('data.json')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Tekshirish' }));
    await waitFor(() => expect(screen.getByText('Faoliyat mazmuni noto‘g‘ri.')).toBeInTheDocument());
    expect(screen.getByText('lessons[0].revision.activities[1].payload')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import qilish' })).toBeDisabled();
  });

  it('WEB-IMP-07/08 valid dry-run enables apply; apply re-sends the SAME document (dry-run not trusted)', async () => {
    h.validate.mockResolvedValue(okResult);
    h.apply.mockResolvedValue({ schemaVersion: 'izlan-topic-content/v1', documentHash: 'a'.repeat(64), summary: SUMMARY, lessons: [{ contentKey: 'CK-1', lessonId: 'l1', revisionId: 'r1' }] });
    renderDialog();
    await loadFile(VALID_DOC);
    await waitFor(() => expect(screen.getByText('data.json')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Tekshirish' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Import qilish' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Import qilish' }));
    // confirm dialog
    const confirm = (await screen.findAllByRole('dialog')).at(-1)!;
    fireEvent.click(within(confirm).getByRole('button', { name: 'Import qilish' }));
    await waitFor(() => expect(h.apply).toHaveBeenCalledWith('topic-1', JSON.parse(VALID_DOC)));
    await waitFor(() => expect(screen.getByText('Import muvaffaqiyatli yakunlandi')).toBeInTheDocument());
  });

  it('WEB-IMP-09 double-click cannot submit two apply calls', async () => {
    h.validate.mockResolvedValue(okResult);
    let resolveApply: (v: unknown) => void = () => {};
    h.apply.mockReturnValue(new Promise((r) => (resolveApply = r)));
    renderDialog();
    await loadFile(VALID_DOC);
    await waitFor(() => expect(screen.getByText('data.json')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Tekshirish' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Import qilish' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Import qilish' }));
    const confirm = (await screen.findAllByRole('dialog')).at(-1)!;
    const confirmBtn = within(confirm).getByRole('button', { name: 'Import qilish' });
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn); // second click while busy
    resolveApply({ schemaVersion: 'izlan-topic-content/v1', documentHash: 'a'.repeat(64), summary: SUMMARY, lessons: [] });
    await waitFor(() => expect(h.imported).toHaveBeenCalled());
    expect(h.apply).toHaveBeenCalledTimes(1);
  });

  it('WEB-IMP-10/11 document never persisted to storage; answerKey never rendered', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    h.validate.mockResolvedValue(okResult);
    renderDialog();
    await loadFile(JSON.stringify({ schemaVersion: 'izlan-topic-content/v1', lessons: [{ payload: { answerKey: { correctOptionIds: [SECRET] } } }] }));
    await waitFor(() => expect(screen.getByText('data.json')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Tekshirish' }));
    await waitFor(() => expect(screen.getByText('Yaroqli')).toBeInTheDocument());
    expect(document.body.textContent).not.toContain(SECRET); // answerKey never rendered
    expect(setItem).not.toHaveBeenCalled(); // never written to storage
    expect(localStorage.length).toBe(0);
    setItem.mockRestore();
  });

  it('WEB-IMP-apply-conflict surfaces the authoritative error and forces a re-check', async () => {
    h.validate.mockResolvedValue(okResult);
    h.apply.mockRejectedValue(new ApiError(409, 'IMPORT_CONTENT_KEY_EXISTS', 'x'));
    renderDialog();
    await loadFile(VALID_DOC);
    await waitFor(() => expect(screen.getByText('data.json')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Tekshirish' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Import qilish' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Import qilish' }));
    const confirm = (await screen.findAllByRole('dialog')).at(-1)!;
    fireEvent.click(within(confirm).getByRole('button', { name: 'Import qilish' }));
    await waitFor(() => expect(screen.getByText('Bunday content key’li dars allaqachon mavjud.')).toBeInTheDocument());
  });

  it('WEB-IMP-12 uz/ru/en import chrome switches with locale', async () => {
    renderDialog();
    expect(screen.getByText('Kontent importi')).toBeInTheDocument(); // uz
    fireEvent.click(screen.getByText('to-ru'));
    expect(screen.getByText('Импорт контента')).toBeInTheDocument(); // ru
    fireEvent.click(screen.getByText('to-en'));
    expect(screen.getByText('Content import')).toBeInTheDocument(); // en
  });
});
