import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseImportDocument } from './import-parser';
import { documentHash } from './import-contract';
import { ContentImportError } from '../common/errors';

const md = (text = 'ok') => ({ schemaVersion: 'lesson-activity-markdown/v1', markdown: text });
const validDoc = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 'izlan-topic-content/v1',
  skills: [{ code: 'A', name: 'A' }],
  lessons: [{ contentKey: 'CK-1', sortOrder: 1, skillCodes: ['A'], revision: { title: 'L', activities: [{ type: 'TEXT', payload: md() }] } }],
  ...over,
});

describe('import parser (pure, TD-253)', () => {
  it('the canonical example file parses with zero structural issues', () => {
    const raw = JSON.parse(readFileSync(join(__dirname, '../../examples/izlan-topic-content.v1.json'), 'utf8'));
    const { plan, issues } = parseImportDocument(raw);
    expect(issues).toEqual([]);
    expect(plan.lessons).toHaveLength(2);
    expect(plan.lessons[0].revision.activities.map((a) => a.position)).toEqual([0, 1]);
    expect(documentHash(plan)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('documentHash is stable regardless of object key order', () => {
    const h1 = documentHash(parseImportDocument(validDoc()).plan);
    const reordered = { lessons: validDoc().lessons, skills: validDoc().skills, schemaVersion: 'izlan-topic-content/v1' };
    const h2 = documentHash(parseImportDocument(reordered).plan);
    expect(h1).toBe(h2);
  });

  it('rejects wrong schemaVersion and non-object root (hard 400)', () => {
    expect(() => parseImportDocument({ schemaVersion: 'x', lessons: [] })).toThrow(ContentImportError);
    expect(() => parseImportDocument([])).toThrow(ContentImportError);
  });

  it('collects unknown top-level + nested fields (a typo fails, never silently ignored)', () => {
    const { issues } = parseImportDocument(validDoc({ skillCodez: [] }));
    expect(issues.some((i) => i.code === 'IMPORT_INVALID_DOCUMENT' && i.path === 'skillCodez')).toBe(true);
  });

  it('rejects unsupported (media) activity type and malformed markdown', () => {
    const media = parseImportDocument(validDoc({ skills: [], lessons: [{ contentKey: 'CK', sortOrder: 1, revision: { title: 'L', activities: [{ type: 'IMAGE', payload: { schemaVersion: 'lesson-activity-media/v1' } }] } }] }));
    expect(media.issues.some((i) => i.code === 'IMPORT_ACTIVITY_TYPE_UNSUPPORTED')).toBe(true);
    const badMd = parseImportDocument(validDoc({ skills: [], lessons: [{ contentKey: 'CK', sortOrder: 1, revision: { title: 'L', activities: [{ type: 'TEXT', payload: { schemaVersion: 'lesson-activity-markdown/v1', markdown: '' } }] } }] }));
    expect(badMd.issues.some((i) => i.code === 'IMPORT_ACTIVITY_PAYLOAD_INVALID')).toBe(true);
  });
});
