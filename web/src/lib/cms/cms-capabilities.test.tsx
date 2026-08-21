import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen, waitFor } from '@testing-library/react';
import { CmsProvider, useCapabilities } from './cms-context';
import { setAccessToken, clearAccessToken } from '../auth/token-store';
import { __resetRefreshLatchForTests } from '../api/client';
import { installFetchMock, type MockCall } from '../../test/fetch-mock';

const isSession = (c: MockCall) => c.url.endsWith('/api/staff/content/session');

function CapProbe() {
  const caps = useCapabilities();
  return (
    <div>
      {caps.author && <span>author-yes</span>}
      {caps.publish ? <span>publish-yes</span> : <span>publish-no</span>}
      {caps.subjectManage ? <span>manage-yes</span> : <span>manage-no</span>}
    </div>
  );
}

describe('WEB-06 CMS UI is driven by capabilities, not role strings', () => {
  beforeEach(() => {
    clearAccessToken();
    __resetRefreshLatchForTests();
  });

  it('renders gated markers strictly from the capability booleans returned by /session', async () => {
    setAccessToken('tok');
    installFetchMock((c) => {
      if (isSession(c)) return { status: 200, body: { userId: 'u1', capabilities: { author: true, publish: false, subjectManage: true } } };
      return { status: 404, body: {} };
    });
    render(
      <CmsProvider>
        <CapProbe />
      </CmsProvider>,
    );
    await waitFor(() => expect(screen.getByText('author-yes')).toBeInTheDocument());
    expect(screen.getByText('publish-no')).toBeInTheDocument();
    expect(screen.getByText('manage-yes')).toBeInTheDocument();
  });

  it('no CMS decision component hard-codes role-name strings', () => {
    const files = [
      'src/components/shell/AppShell.tsx',
      'src/app/staff/content/page.tsx',
      'src/app/staff/content/subjects/[subjectId]/page.tsx',
      'src/app/staff/content/lessons/[lessonId]/page.tsx',
      'src/components/revision/WorkflowActions.tsx',
    ];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(/['"](ADMIN|METHODIST|MODERATOR|LEARNER)['"]/);
    }
  });
});
