import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EntityFormDialog } from './EntityFormDialog';
import { ApiError } from '@/lib/api/errors';

describe('WEB-08 OCC edit conflict → conflict state, no silent retry', () => {
  it('shows the conflict banner and calls onSubmit exactly once on CONTENT_EDIT_CONFLICT', async () => {
    const onSubmit = vi.fn(async () => {
      throw new ApiError(409, 'CONTENT_EDIT_CONFLICT', 'conflict');
    });
    render(
      <EntityFormDialog
        open
        title="Tahrirlash"
        fields={[{ name: 'title', label: 'Sarlavha', type: 'text', required: true }]}
        initial={{ title: 'X' }}
        onSubmit={onSubmit}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Saqlash' }));

    await waitFor(() => expect(screen.getByText(/boshqa joyda o'zgartirilgan/i)).toBeInTheDocument());
    // reload / cancel affordances present; NO automatic retry
    expect(screen.getByRole('button', { name: /Eng so'nggisini yuklash/i })).toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
