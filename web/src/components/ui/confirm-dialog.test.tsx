import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from './dialog';

describe('WEB-14 PUBLISHED lesson takedown requires a reason', () => {
  it('confirm is disabled until a reason is entered, then passes the trimmed reason', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onClose={() => {}}
        onConfirm={onConfirm}
        title="Darsni takedown qilish"
        message="Arxivlanadi"
        confirmLabel="Takedown"
        danger
        requireReason
        reasonLabel="Sabab"
      />,
    );

    const confirm = screen.getByRole('button', { name: 'Takedown' });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Sabab'), { target: { value: '  xavfsizlik  ' } });
    expect(confirm).not.toBeDisabled();

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('xavfsizlik');
  });
});
