import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import { LessonMedia } from './LessonMedia';

const h = vi.hoisted(() => ({ fetchMediaObjectUrl: vi.fn() }));
vi.mock('@/lib/api/media', () => ({ fetchMediaObjectUrl: h.fetchMediaObjectUrl }));

const image = { id: 'm-img', kind: 'image', mimeType: 'image/png', altText: 'A family tree diagram' };
const audio = { id: 'm-aud', kind: 'audio', mimeType: 'audio/mpeg', altText: 'Good morning' };

function renderMedia(media: object[]) {
  return render(<I18nProvider><LessonMedia media={media as never} /></I18nProvider>);
}

describe('LessonMedia (WEB-MEDIA)', () => {
  const revoke = vi.fn();
  beforeEach(() => {
    h.fetchMediaObjectUrl.mockReset();
    revoke.mockReset();
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = revoke;
  });
  afterEach(() => vi.clearAllMocks());

  it('WEB-MEDIA-01 renders an image from an authenticated blob with its alt text (never a storageKey)', async () => {
    h.fetchMediaObjectUrl.mockResolvedValue('blob:img');
    renderMedia([image]);
    const img = (await screen.findByRole('img')) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('blob:img');
    expect(img.getAttribute('alt')).toBe('A family tree diagram');
    expect(h.fetchMediaObjectUrl).toHaveBeenCalledWith('m-img'); // fetched by asset id, not a URL/key
    expect(document.body.textContent).not.toContain('storage');
  });

  it('WEB-MEDIA-02 renders audio with native controls and a label (no autoplay)', async () => {
    h.fetchMediaObjectUrl.mockResolvedValue('blob:aud');
    const { container } = renderMedia([audio]);
    await waitFor(() => expect(container.querySelector('audio')).not.toBeNull());
    const el = container.querySelector('audio')!;
    expect(el.getAttribute('src')).toBe('blob:aud');
    expect(el.hasAttribute('controls')).toBe(true);
    expect(el.hasAttribute('autoplay')).toBe(false);
    expect(screen.getByText('Good morning')).toBeInTheDocument();
  });

  it('WEB-MEDIA-03 a media fetch failure shows a truthful error and never crashes the lesson', async () => {
    h.fetchMediaObjectUrl.mockRejectedValue(new Error('boom'));
    renderMedia([image]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Media yuklanmadi.');
    expect(screen.queryByRole('img')).toBeNull(); // no broken image element
  });

  it('WEB-MEDIA-04 revokes the object URL on unmount (no leak)', async () => {
    h.fetchMediaObjectUrl.mockResolvedValue('blob:img');
    const { unmount } = renderMedia([image]);
    await screen.findByRole('img');
    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:img');
  });

  it('WEB-MEDIA-05 renders nothing when there is no attached media', () => {
    const { container } = renderMedia([]);
    expect(container.firstChild).toBeNull();
    expect(h.fetchMediaObjectUrl).not.toHaveBeenCalled();
  });
});
