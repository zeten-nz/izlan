import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button, ButtonLink, buttonClassName } from './index';

describe('Button foundation (WEB-BTN)', () => {
  it('WEB-BTN-01 buttonClassName reflects variant + the canonical 36/44/48/52 size scale', () => {
    expect(buttonClassName({ variant: 'primary' })).toContain('bg-primary');
    expect(buttonClassName({ variant: 'secondary' })).toContain('border-border');
    expect(buttonClassName({ variant: 'ghost' })).toContain('hover:bg-surface-2');
    expect(buttonClassName({ variant: 'danger' })).toContain('bg-danger');
    expect(buttonClassName({ size: 'sm' })).toContain('h-9'); // 36
    expect(buttonClassName({ size: 'md' })).toContain('h-11'); // 44 (default)
    expect(buttonClassName({ size: 'lg' })).toContain('h-12'); // 48
    expect(buttonClassName({ size: 'xl' })).toContain('h-[52px]'); // 52
    expect(buttonClassName()).toContain('rounded-control'); // 10px canonical radius
  });

  it('WEB-BTN-02 Button renders a real <button>; loading disables it', () => {
    const { rerender } = render(<Button>Saqlash</Button>);
    const btn = screen.getByRole('button', { name: 'Saqlash' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).not.toBeDisabled();
    rerender(
      <Button loading>Saqlash</Button>,
    );
    expect(screen.getByRole('button', { name: 'Saqlash' })).toBeDisabled();
  });

  it('WEB-BTN-03 ButtonLink is a navigating anchor (no nested button) sharing the Button style', () => {
    render(
      <ButtonLink href="/login" variant="secondary" size="lg">
        Kirish
      </ButtonLink>,
    );
    const link = screen.getByRole('link', { name: 'Kirish' });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/login');
    expect(link.querySelector('button')).toBeNull(); // never nest a button inside an anchor
    expect(link.className).toContain('border-border'); // secondary
    expect(link.className).toContain('h-12'); // lg (48)
  });
});
