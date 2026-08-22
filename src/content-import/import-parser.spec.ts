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

  // ── Blocker B: package-local determinism (dry-run must reject what apply would reject) ──
  it('rejects two declared skills with different codes but identical names (DB name-unique)', () => {
    const { issues } = parseImportDocument(validDoc({ skills: [{ code: 'C1', name: 'Same' }, { code: 'C2', name: 'Same' }], lessons: [] }));
    expect(issues.some((i) => i.code === 'IMPORT_SKILL_DUPLICATE')).toBe(true);
  });

  it('rejects duplicate items in skillCodes / prerequisiteContentKeys (no silent dedup)', () => {
    const dupSkill = parseImportDocument(validDoc({ skills: [{ code: 'A', name: 'A' }], lessons: [{ contentKey: 'CK-1', sortOrder: 1, skillCodes: ['A', 'A'], revision: { title: 'L', activities: [{ type: 'TEXT', payload: md() }] } }] }));
    expect(dupSkill.issues.some((i) => i.code === 'IMPORT_INVALID_DOCUMENT' && i.path === 'lessons[0].skillCodes[1]')).toBe(true);
    const dupPrereq = parseImportDocument(validDoc({ skills: [], lessons: [{ contentKey: 'CK-1', sortOrder: 1, prerequisiteContentKeys: ['CK-X', 'CK-X'], revision: { title: 'L', activities: [{ type: 'TEXT', payload: md() }] } }] }));
    expect(dupPrereq.issues.some((i) => i.code === 'IMPORT_INVALID_DOCUMENT' && i.path === 'lessons[0].prerequisiteContentKeys[1]')).toBe(true);
  });

  it('prerequisite keys follow contentKey syntax (>80 chars allowed), not the ≤80 skill-code rule', () => {
    const longKey = `CK-${'A'.repeat(120)}`;
    const { plan, issues } = parseImportDocument(validDoc({ skills: [], lessons: [{ contentKey: 'CK-1', sortOrder: 1, prerequisiteContentKeys: [longKey], revision: { title: 'L', activities: [{ type: 'TEXT', payload: md() }] } }] }));
    expect(issues.filter((i) => i.path.startsWith('lessons[0].prerequisiteContentKeys'))).toEqual([]);
    expect(plan.lessons[0].prerequisiteContentKeys).toEqual([longKey]);
  });

  it('rejects an aggregate relationship cap violation (hard 400) before any DB work', () => {
    const codes = Array.from({ length: 100 }, (_, i) => `SK${i}`);
    const skills = codes.map((code) => ({ code, name: code }));
    const lessons = Array.from({ length: 101 }, (_, i) => ({ contentKey: `LSK-${i}`, sortOrder: i, skillCodes: codes, revision: { title: 'L', activities: [{ type: 'TEXT', payload: md() }] } }));
    expect(() => parseImportDocument({ schemaVersion: 'izlan-topic-content/v1', skills, lessons })).toThrow(ContentImportError); // 101 × 100 = 10,100 > 10,000
  });

  // ── Provenance (TD-254) ──
  it('provenance omitted → HUMAN (backward compatible); explicit sources accepted', () => {
    expect(parseImportDocument(validDoc()).plan.provenance.source).toBe('HUMAN');
    expect(parseImportDocument(validDoc({ provenance: { source: 'AI_ASSISTED' } })).plan.provenance.source).toBe('AI_ASSISTED');
    expect(parseImportDocument(validDoc({ provenance: { source: 'AI_GENERATED' } })).plan.provenance.source).toBe('AI_GENERATED');
  });

  it('IMP-PROV-04 invalid source or unknown provenance field → IMPORT_INVALID_DOCUMENT', () => {
    expect(parseImportDocument(validDoc({ provenance: { source: 'ROBOT' } })).issues.some((i) => i.code === 'IMPORT_INVALID_DOCUMENT' && i.path === 'provenance.source')).toBe(true);
    expect(parseImportDocument(validDoc({ provenance: { source: 'HUMAN', model: 'x' } })).issues.some((i) => i.code === 'IMPORT_INVALID_DOCUMENT' && i.path === 'provenance.model')).toBe(true);
  });

  it('IMP-PROV-05 documentHash differs between HUMAN and AI_ASSISTED', () => {
    const h1 = documentHash(parseImportDocument(validDoc({ provenance: { source: 'HUMAN' } })).plan);
    const h2 = documentHash(parseImportDocument(validDoc({ provenance: { source: 'AI_ASSISTED' } })).plan);
    expect(h1).not.toBe(h2);
  });
});
