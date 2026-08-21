import { describe, it, expect } from 'vitest';
import { toSafePreviewActivity } from './preview-view-model';
import type { PreviewActivity } from '../api/types';

describe('WEB-11 preview allowlist drops secrets', () => {
  it('objective safe model contains ONLY id/type/position/format/prompt/options, never answerKey/correctOptionIds/storageKey', () => {
    const malicious: PreviewActivity = {
      id: 'act1',
      type: 'MINI_QUESTION',
      position: 0,
      format: 'single_choice',
      prompt: 'Q?',
      options: [
        { id: 'a', text: 'A', extra: 'IGNORED' },
        { id: 'b', text: 'B' },
      ],
      // these must never survive into the safe model:
      answerKey: { correctOptionIds: ['a'] },
      correctOptionIds: ['a'],
      storageKey: 'SECRET-STORAGE',
    } as unknown as PreviewActivity;

    const safe = toSafePreviewActivity(malicious);
    const json = JSON.stringify(safe);
    expect(json).not.toMatch(/answerKey/);
    expect(json).not.toMatch(/correctOptionIds/);
    expect(json).not.toMatch(/storageKey/);
    expect(json).not.toMatch(/SECRET-STORAGE/);
    expect(json).not.toMatch(/IGNORED/); // option extras are not copied either
    if (safe.kind === 'objective') {
      expect(safe.options).toEqual([
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ]);
    } else {
      throw new Error('expected objective');
    }
  });

  it('markdown safe model exposes only markdown text', () => {
    const raw = { id: 'm', type: 'TEXT', position: 1, schemaVersion: 'lesson-activity-markdown/v1', markdown: 'Hello', storageKey: 'X' } as unknown as PreviewActivity;
    const safe = toSafePreviewActivity(raw);
    expect(safe.kind).toBe('markdown');
    expect(JSON.stringify(safe)).not.toMatch(/storageKey/);
  });
});
