import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { Dialog } from '@/components/ui/dialog';
import { CommandPalette } from '@/components/shell/CommandPalette';
import { ThemeProvider } from '@/lib/theme/theme-context';

// CommandPalette loads assigned subjects — stub it so the palette renders without network.
vi.mock('@/lib/api/content', () => ({ listSubjects: () => Promise.resolve([]) }));
// next/navigation router (used by the palette).
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button data-testid="trigger" onClick={() => setOpen(true)}>
        open
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Test dialog">
        <input data-testid="f1" aria-label="field one" />
        <input data-testid="f2" aria-label="field two" />
      </Dialog>
    </>
  );
}

function focusablesOf(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

describe('Modal focus accessibility (Dialog)', () => {
  it('UI-A11Y-01 opening the dialog moves focus to the first control inside it', async () => {
    render(<DialogHarness />);
    fireEvent.click(screen.getByTestId('trigger'));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      const items = focusablesOf(dialog);
      expect(items.length).toBeGreaterThan(0);
      expect(dialog.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).toBe(items[0]);
    });
  });

  it('UI-A11Y-02 Tab from the last focusable wraps to the first', async () => {
    render(<DialogHarness />);
    fireEvent.click(screen.getByTestId('trigger'));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    const items = focusablesOf(dialog);
    const first = items[0]!;
    const last = items[items.length - 1]!;
    act(() => last.focus());
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('UI-A11Y-03 Shift+Tab from the first focusable wraps to the last', async () => {
    render(<DialogHarness />);
    fireEvent.click(screen.getByTestId('trigger'));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    const items = focusablesOf(dialog);
    const first = items[0]!;
    const last = items[items.length - 1]!;
    act(() => first.focus());
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('UI-A11Y-04 closing the dialog restores focus to the trigger', async () => {
    render(<DialogHarness />);
    const trigger = screen.getByTestId('trigger');
    act(() => trigger.focus());
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    // close via Escape
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

function PaletteHarness() {
  const [open, setOpen] = useState(false);
  return (
    <ThemeProvider>
      <button data-testid="palette-trigger" onClick={() => setOpen(true)}>
        open palette
      </button>
      <CommandPalette open={open} onClose={() => setOpen(false)} />
    </ThemeProvider>
  );
}

describe('Command palette focus accessibility', () => {
  it('UI-A11Y-05 palette focuses the search input, then restores focus to the opener on close', async () => {
    render(<PaletteHarness />);
    const trigger = screen.getByTestId('palette-trigger');
    act(() => trigger.focus());
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByRole('textbox');
    await waitFor(() => expect(document.activeElement).toBe(input));
    // Escape closes; focus returns to the invoking control
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
