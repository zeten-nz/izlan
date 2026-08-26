import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { ToastProvider } from '@/components/ui';
import { ActivityMediaPanel } from './ActivityMediaPanel';

const h = vi.hoisted(() => ({ upload: vi.fn(), attach: vi.fn(), detach: vi.fn(), list: vi.fn() }));
vi.mock('@/lib/api/media', () => ({ uploadMedia: h.upload, attachActivityMedia: h.attach, detachActivityMedia: h.detach, listActivityMedia: h.list }));

function renderPanel(editable = true, onToken = vi.fn()) {
  return render(
    <ThemeProvider><I18nProvider><ToastProvider>
      <ActivityMediaPanel activityId="act1" editable={editable} revisionUpdatedAt="2026-01-01T00:00:00.000Z" onTokenChange={onToken} />
    </ToastProvider></I18nProvider></ThemeProvider>,
  );
}

describe('ActivityMediaPanel (WEB-MEDIA-PANEL)', () => {
  beforeEach(() => Object.values(h).forEach((f) => f.mockReset()));

  it('WEB-MEDIA-PANEL-01 lists attached media (alt + kind), never a storageKey', async () => {
    h.list.mockResolvedValue([{ id: 'm1', kind: 'image', mimeType: 'image/png', altText: 'A diagram' }]);
    renderPanel();
    expect(await screen.findByText('A diagram')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('storageKey');
  });

  it('WEB-MEDIA-PANEL-02 uploads the file, attaches with the alt text, rotates the token, and reloads', async () => {
    h.list.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'm9', kind: 'image', mimeType: 'image/png', altText: 'cat' }]);
    h.upload.mockResolvedValue({ id: 'm9', kind: 'image', mimeType: 'image/png' }); // upload result carries NO alt text
    h.attach.mockResolvedValue({ revisionUpdatedAt: '2026-02-02T00:00:00.000Z' });
    const onToken = vi.fn();
    const { container } = renderPanel(true, onToken);
    await screen.findByText('Hozircha media biriktirilmagan.');
    fireEvent.change(screen.getByPlaceholderText('Rasmni qisqa tavsiflang'), { target: { value: 'cat' } }); // alt required for image
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'cat.png', { type: 'image/png' })] } });
    await waitFor(() => expect(h.upload).toHaveBeenCalled());
    expect(h.upload).toHaveBeenCalledWith(expect.any(File)); // file only — no alt in the upload call
    expect(h.attach).toHaveBeenCalledWith('act1', 'm9', '2026-01-01T00:00:00.000Z', 'cat'); // alt travels with attach
    expect(onToken).toHaveBeenCalledWith('2026-02-02T00:00:00.000Z'); // token threaded forward
    expect(await screen.findByText('cat')).toBeInTheDocument();
  });

  it('WEB-MEDIA-PANEL-02b blocks an image with empty alt text before any upload (no orphan asset)', async () => {
    h.list.mockResolvedValue([]);
    const { container } = renderPanel();
    await screen.findByText('Hozircha media biriktirilmagan.');
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'no-alt.png', { type: 'image/png' })] } });
    expect(await screen.findByText('Rasm uchun alt matn majburiy.')).toBeInTheDocument();
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.attach).not.toHaveBeenCalled();
  });

  it('WEB-MEDIA-PANEL-03 removes an attachment (detach) and updates the token', async () => {
    h.list.mockResolvedValueOnce([{ id: 'm1', kind: 'audio', mimeType: 'audio/mpeg', altText: 'clip' }]).mockResolvedValueOnce([]);
    h.detach.mockResolvedValue({ revisionUpdatedAt: '2026-03-03T00:00:00.000Z' });
    const onToken = vi.fn();
    renderPanel(true, onToken);
    fireEvent.click(await screen.findByRole('button', { name: 'Olib tashlash' }));
    await waitFor(() => expect(h.detach).toHaveBeenCalledWith('act1', 'm1', '2026-01-01T00:00:00.000Z'));
    expect(onToken).toHaveBeenCalledWith('2026-03-03T00:00:00.000Z');
  });

  it('WEB-MEDIA-PANEL-04 read-only (non-editable) shows the list but no upload/remove controls', async () => {
    h.list.mockResolvedValue([{ id: 'm1', kind: 'image', mimeType: 'image/png', altText: 'A diagram' }]);
    const { container } = renderPanel(false);
    expect(await screen.findByText('A diagram')).toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Olib tashlash' })).toBeNull();
  });
});
