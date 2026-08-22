import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { WorkflowActions } from './WorkflowActions';
import { RevisionEditorProvider } from '@/lib/cms/revision-editor-context';
import { CmsProvider } from '@/lib/cms/cms-context';
import { ToastProvider } from '@/components/ui/toast';
import { setAccessToken, clearAccessToken } from '@/lib/auth/token-store';
import { __resetRefreshLatchForTests } from '@/lib/api/client';
import { installFetchMock, type MockCall } from '@/test/fetch-mock';
import { makeLesson, makeRevision } from '@/test/factories';

const isPublish = (c: MockCall) => c.url.endsWith('/api/staff/content/revisions/rev1/publish') && c.method === 'POST';

describe('WEB-12 publish is blocked when readiness says not publish-ready', () => {
  beforeEach(() => {
    clearAccessToken();
    __resetRefreshLatchForTests();
    setAccessToken('tok');
  });

  it('clicking Publish with publishReady=false does not open the confirm dialog nor call publish', async () => {
    const mock = installFetchMock((c) => {
      if (c.url.endsWith('/api/staff/content/session')) return { status: 200, body: { userId: 'u1', capabilities: { author: true, publish: true, subjectManage: false } } };
      if (c.url.endsWith('/api/staff/content/revisions/rev1/readiness')) return { status: 200, body: { revisionId: 'rev1', reviewReady: true, publishReady: false, blockers: [{ code: 'ACTIVITY_NONE', scope: 'revision' }], warnings: [] } };
      if (c.url.endsWith('/api/staff/content/lessons/les1')) return { status: 200, body: makeLesson({ status: 'PUBLISHED' }) };
      return { status: 404, body: {} };
    });

    render(
      <ToastProvider>
        <CmsProvider>
          <RevisionEditorProvider initial={makeRevision({ status: 'REVIEW' })}>
            <WorkflowActions />
          </RevisionEditorProvider>
        </CmsProvider>
      </ToastProvider>,
    );

    // label from the uz dictionary (workflow.publish); no I18nProvider here → default (uz) translator
    const publishBtn = await screen.findByRole('button', { name: 'Nashr qilish' });
    fireEvent.click(publishBtn);

    await waitFor(() => expect(mock.countMatching((c) => c.url.endsWith('/readiness'))).toBeGreaterThan(0));
    // not-ready → no confirm dialog (workflow.publishTitle), no publish call
    expect(screen.queryByText('Versiyani nashr qilish')).toBeNull();
    expect(mock.countMatching(isPublish)).toBe(0);
  });
});
