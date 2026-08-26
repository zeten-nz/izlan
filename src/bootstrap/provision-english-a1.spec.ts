import { A1_DIAGNOSTIC_ITEMS, assertProvisionAllowed, type ProvisionEnv } from './provision-english-a1';
import { parseItemPayload, isObjectiveFormat } from '../assessment/scoring/item-payload';
import { loadManifest } from '../content-import/pilot/english-a1-pilot';

const OK: ProvisionEnv = { nodeEnv: 'development', allowDevFixture: 'true' };

describe('provision-english-a1 (dev guards + diagnostic items)', () => {
  it('PROV-01 allows only in non-production WITH the dev opt-in', () => {
    expect(() => assertProvisionAllowed(OK)).not.toThrow();
    expect(() => assertProvisionAllowed({ ...OK, nodeEnv: 'test' })).not.toThrow();
  });

  it('PROV-02 is forbidden in production even with the flag', () => {
    expect(() => assertProvisionAllowed({ ...OK, nodeEnv: 'production' })).toThrow(/forbidden in production/);
  });

  it('PROV-03 requires ALLOW_DEV_FIXTURE=true', () => {
    expect(() => assertProvisionAllowed({ ...OK, allowDevFixture: undefined })).toThrow(/ALLOW_DEV_FIXTURE/);
    expect(() => assertProvisionAllowed({ ...OK, allowDevFixture: 'false' })).toThrow(/ALLOW_DEV_FIXTURE/);
  });

  it('PROV-04 defines exactly one diagnostic item per pilot skill (covers all 13, no extras/dupes)', () => {
    const manifestCodes = new Set(loadManifest().skills.map((s) => s.code));
    const itemCodes = A1_DIAGNOSTIC_ITEMS.map((i) => i.skillCode);
    expect(itemCodes.length).toBe(13);
    expect(new Set(itemCodes).size).toBe(13); // no duplicate skill
    expect(new Set(itemCodes)).toEqual(manifestCodes); // exact coverage of the pilot skill set
  });

  it('PROV-05 every diagnostic item is a valid objective placement item (parses, one correct answer within options, difficulty in scale)', () => {
    for (const it of A1_DIAGNOSTIC_ITEMS) {
      const parsed = parseItemPayload(it.payload); // the REAL engine validator — throws on anything malformed
      expect(isObjectiveFormat(parsed.format)).toBe(true);
      expect(parsed.format).toBe('single_choice');
      const optionIds = new Set((parsed.options ?? []).map((o) => o.id));
      expect(optionIds.size).toBeGreaterThanOrEqual(2);
      expect(parsed.answerKey?.correctOptionIds).toHaveLength(1); // exactly one correct
      expect(optionIds.has(parsed.answerKey!.correctOptionIds[0])).toBe(true); // correct is a real option
      expect(it.difficulty).toBeGreaterThanOrEqual(1);
      expect(it.difficulty).toBeLessThanOrEqual(6); // within the seeded profileScale [1,6]
    }
  });
});
