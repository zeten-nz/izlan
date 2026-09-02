import { deriveTeachingMastery, evaluateTeachingMastery, MasteryGates, TeachingMasteryEntry } from './teaching-mastery.engine';

const gates: MasteryGates = { thresholdBp: 8000, minIndependence: 1 };
const recognition = (over: Partial<Parameters<typeof deriveTeachingMastery>[0][number]>) => ({ activityId: 'a', bestScoreBp: 10000, evidenceKind: 'recognition', independenceLevel: 1, skillIds: ['s1'], ...over });
const controlled = (over: Partial<Parameters<typeof deriveTeachingMastery>[0][number]>) => ({ activityId: 'a', bestScoreBp: 10000, evidenceKind: 'controlled-production', independenceLevel: 2, skillIds: ['s1'], ...over });
const entry = (over: Partial<TeachingMasteryEntry>): TeachingMasteryEntry => ({ skillId: 's1', scoreBp: 9000, confidenceBp: 10000, evidenceCount: 1, evidenceKind: 'recognition', independenceLevel: 1, ...over });

describe('teaching-mastery.engine (V2 mastery)', () => {
  describe('deriveTeachingMastery', () => {
    it('averages best scores per skill; confidence = complete coverage; evidenceCount = distinct activities', () => {
      const out = deriveTeachingMastery([
        recognition({ activityId: 'x', bestScoreBp: 10000, skillIds: ['s1'] }),
        recognition({ activityId: 'y', bestScoreBp: 6000, skillIds: ['s1'] }),
        recognition({ activityId: 'z', bestScoreBp: 9000, skillIds: ['s2'] }),
      ]);
      expect(out).toEqual([
        { skillId: 's1', scoreBp: 8000, confidenceBp: 10000, evidenceCount: 2, evidenceKind: 'recognition', independenceLevel: 1 },
        { skillId: 's2', scoreBp: 9000, confidenceBp: 10000, evidenceCount: 1, evidenceKind: 'recognition', independenceLevel: 1 },
      ]);
    });

    it('per skill takes the MAX independence + that activity\'s evidence kind (structured beats recognition)', () => {
      const out = deriveTeachingMastery([
        recognition({ activityId: 'x', bestScoreBp: 9000, skillIds: ['s1'] }),
        controlled({ activityId: 'y', bestScoreBp: 9000, skillIds: ['s1'] }),
      ]);
      expect(out[0]).toMatchObject({ skillId: 's1', independenceLevel: 2, evidenceKind: 'controlled-production', evidenceCount: 2 });
    });

    it('attributes one activity to every mapped skill', () => {
      const out = deriveTeachingMastery([controlled({ activityId: 'x', bestScoreBp: 10000, skillIds: ['s1', 's2'] })]);
      expect(out.map((e) => e.skillId)).toEqual(['s1', 's2']);
      expect(out.every((e) => e.scoreBp === 10000 && e.evidenceCount === 1 && e.independenceLevel === 2)).toBe(true);
    });
  });

  describe('evaluateTeachingMastery', () => {
    it('SATISFIED when every required skill meets threshold + independence', () => {
      const entries = [entry({ skillId: 's1', scoreBp: 9000, independenceLevel: 2 }), entry({ skillId: 's2', scoreBp: 8000, independenceLevel: 2 })];
      const r = evaluateTeachingMastery(['s1', 's2'], entries, gates);
      expect(r.outcome).toBe('SATISFIED');
      expect(r.gates.every((g) => g.passed)).toBe(true);
    });

    it('NOT_SATISFIED when a required skill is below threshold', () => {
      const entries = [entry({ skillId: 's1', scoreBp: 9000 }), entry({ skillId: 's2', scoreBp: 5000 })];
      const r = evaluateTeachingMastery(['s1', 's2'], entries, gates);
      expect(r.outcome).toBe('NOT_SATISFIED');
      expect(r.gates.find((g) => g.skillId === 's2')?.reason).toBe('below_threshold');
    });

    it('INSUFFICIENT_EVIDENCE when a required skill has no evidence', () => {
      const r = evaluateTeachingMastery(['s1', 's2'], [entry({ skillId: 's1', scoreBp: 10000 })], gates);
      expect(r.outcome).toBe('INSUFFICIENT_EVIDENCE');
      expect(r.gates.find((g) => g.skillId === 's2')?.reason).toBe('no_evidence');
      expect(r.gates.find((g) => g.skillId === 's2')?.scoreBp).toBeNull();
    });

    it('recognition-only evidence (independence 1) CANNOT satisfy a controlled-production gate (minIndependence 2)', () => {
      const r = evaluateTeachingMastery(['s1'], [entry({ scoreBp: 10000, evidenceKind: 'recognition', independenceLevel: 1 })], { thresholdBp: 8000, minIndependence: 2 });
      expect(r.outcome).toBe('NOT_SATISFIED');
      expect(r.gates[0].reason).toBe('below_independence');
    });

    it('structured production evidence (independence 2) satisfies the same minIndependence-2 gate', () => {
      const r = evaluateTeachingMastery(['s1'], [entry({ scoreBp: 9000, evidenceKind: 'controlled-production', independenceLevel: 2 })], { thresholdBp: 8000, minIndependence: 2 });
      expect(r.outcome).toBe('SATISFIED');
    });
  });
});
