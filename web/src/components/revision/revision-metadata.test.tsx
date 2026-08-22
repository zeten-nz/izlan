import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RevisionMetadataForm } from './RevisionMetadataForm';
import { RevisionEditorProvider } from '@/lib/cms/revision-editor-context';
import { ToastProvider } from '@/components/ui/toast';
import { makeRevision } from '@/test/factories';

function wrap(editable: boolean, status: 'DRAFT' | 'REVIEW') {
  return render(
    <ToastProvider>
      <RevisionEditorProvider initial={makeRevision({ status, title: 'Muzlagan sarlavha' })}>
        <RevisionMetadataForm editable={editable} onReload={() => {}} />
      </RevisionEditorProvider>
    </ToastProvider>,
  );
}

describe('WEB-13 non-DRAFT (REVIEW) revision freezes authoring controls', () => {
  it('renders read-only text (no inputs) when not editable', () => {
    wrap(false, 'REVIEW');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Muzlagan sarlavha')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Saqlash' })).toBeNull();
  });

  it('renders editable inputs when DRAFT + author', () => {
    wrap(true, 'DRAFT');
    expect(screen.getAllByRole('textbox').length).toBeGreaterThan(0);
  });
});
