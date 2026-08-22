import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RevisionEditorProvider, useRevisionEditor } from './revision-editor-context';
import { makeRevision } from '../../test/factories';

function TokenProbe() {
  const { revision, setRevisionToken } = useRevisionEditor();
  return (
    <div>
      <span data-testid="tok">{revision.updatedAt}</span>
      <button onClick={() => setRevisionToken('t1')}>advance</button>
    </div>
  );
}

describe('WEB-07 revision token authority updates after an activity mutation', () => {
  it('setRevisionToken advances the ONE shared Revision.updatedAt', () => {
    render(
      <RevisionEditorProvider initial={makeRevision({ updatedAt: 't0' })}>
        <TokenProbe />
      </RevisionEditorProvider>,
    );
    expect(screen.getByTestId('tok').textContent).toBe('t0');
    fireEvent.click(screen.getByText('advance'));
    expect(screen.getByTestId('tok').textContent).toBe('t1');
  });
});
