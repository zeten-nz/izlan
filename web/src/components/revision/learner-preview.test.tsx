import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { LearnerPreview } from './LearnerPreview';
import { RevisionEditorProvider } from '@/lib/cms/revision-editor-context';
import { setAccessToken, clearAccessToken } from '@/lib/auth/token-store';
import { __resetRefreshLatchForTests } from '@/lib/api/client';
import { installFetchMock, type MockCall } from '@/test/fetch-mock';
import { makeRevision } from '@/test/factories';

const isPreview = (c: MockCall) => c.url.endsWith('/api/staff/content/revisions/rev1/preview');

describe('WEB-11 learner preview never renders answerKey/correctOptionIds/storageKey', () => {
  beforeEach(() => {
    clearAccessToken();
    __resetRefreshLatchForTests();
    setAccessToken('tok');
  });

  it('renders only allowlisted fields from a malicious preview payload', async () => {
    installFetchMock((c) => {
      if (isPreview(c)) {
        return {
          status: 200,
          body: {
            revisionId: 'rev1',
            lessonId: 'les1',
            version: 1,
            status: 'DRAFT',
            title: 'Preview title',
            description: null,
            estimatedDurationMin: null,
            activities: [
              {
                id: 'a1',
                type: 'MINI_QUESTION',
                position: 0,
                format: 'single_choice',
                prompt: 'Question?',
                options: [
                  { id: 'o1', text: 'Option A' },
                  { id: 'o2', text: 'Option B' },
                ],
                answerKey: { correctOptionIds: ['SECRET-ANSWER-o1'] },
                correctOptionIds: ['SECRET-ANSWER-o1'],
                storageKey: 'SECRET-STORAGE-XYZ',
              },
            ],
          },
        };
      }
      return { status: 404, body: {} };
    });

    const { container } = render(
      <RevisionEditorProvider initial={makeRevision()}>
        <LearnerPreview />
      </RevisionEditorProvider>,
    );

    await waitFor(() => expect(screen.getByText('Option A')).toBeInTheDocument());
    // The rendered DOM must contain NEITHER the secret answer value NOR the storageKey value (allowlist projection).
    const html = container.innerHTML;
    expect(html).not.toMatch(/SECRET-ANSWER/);
    expect(html).not.toMatch(/SECRET-STORAGE-XYZ/);
  });
});
