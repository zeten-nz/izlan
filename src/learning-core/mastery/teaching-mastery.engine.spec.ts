import { deriveTeachingMastery, evaluateTeachingMastery, MasteryGates } from './teaching-mastery.engine';

const gates: MasteryGates = { thresholdBp: 8000, minIndependence: 1 };

describe('teaching-mastery.engine (V2 mastery)', () => {
  describe('deriveTeachingMastery', () => {
    it('averages best scores per skill; confidence = complete coverage; evidenceCount = distinct activities', () => {
      const out = deriveTeachingMastery([
        { activityId: 'x', bestScoreBp: 10000, skillIds: ['s1'] },
        { activityId: 'y', bestScoreBp: 6000, skillIds: ['s1'] },
        { activityId: 'z', bestScoreBp: 9000, skillIds: ['s2'] },
      ]);
      expect(out).toEqual([
        { skillId: 's1', scoreBp: 8000, confidenceBp: 10000, evidenceCount: 2 },
        { skillId: 's2', scoreBp: 9000, confidenceBp: 10000, evidenceCount: 1 },
      ]);
    });

    it('attributes one activity to every mapped skill', () => {
      const out = deriveTeachingMastery([{ activityId: 'x', bestScoreBp: 10000, skillIds: ['s1', 's2'] }]);
      expect(out.map((e) => e.skillId)).toEqual(['s1', 's2']);
      expect(out.every((e) => e.scoreBp === 10000 && e.evidenceCount === 1)).toBe(true);
    });
  });

  describe('evaluateTeachingMastery', () => {
    it('SATISFIED when every required skill meets threshold + independence', () => {
      const entries = [
        { skillId: 's1', scoreBp: 9000, confidenceBp: 10000, evidenceCount: 1 },
        { skillId: 's2', scoreBp: 8000, confidenceBp: 10000, evidenceCount: 1 },
      ];
      const r = evaluateTeachingMastery(['s1', 's2'], entries, 2, gates);
      expect(r.outcome).toBe('SATISFIED');
      expect(r.gates.every((g) => g.passed)).toBe(true);
    });

    it('NOT_SATISFIED when a required skill is below threshold', () => {
      const entries = [
        { skillId: 's1', scoreBp: 9000, confidenceBp: 10000, evidenceCount: 1 },
        { skillId: 's2', scoreBp: 5000, confidenceBp: 10000, evidenceCount: 1 },
      ];
      const r = evaluateTeachingMastery(['s1', 's2'], entries, 2, gates);
      expect(r.outcome).toBe('NOT_SATISFIED');
      expect(r.gates.find((g) => g.skillId === 's2')?.reason).toBe('below_threshold');
    });

    it('INSUFFICIENT_EVIDENCE when a required skill has no evidence', () => {
      const entries = [{ skillId: 's1', scoreBp: 10000, confidenceBp: 10000, evidenceCount: 1 }];
      const r = evaluateTeachingMastery(['s1', 's2'], entries, 2, gates);
      expect(r.outcome).toBe('INSUFFICIENT_EVIDENCE');
      expect(r.gates.find((g) => g.skillId === 's2')?.reason).toBe('no_evidence');
      expect(r.gates.find((g) => g.skillId === 's2')?.scoreBp).toBeNull();
    });

    it('NOT_SATISFIED when independence is below the gate even with a high score', () => {
      const entries = [{ skillId: 's1', scoreBp: 10000, confidenceBp: 10000, evidenceCount: 1 }];
      const r = evaluateTeachingMastery(['s1'], entries, 0, { thresholdBp: 8000, minIndependence: 2 });
      expect(r.outcome).toBe('NOT_SATISFIED');
      expect(r.gates[0].reason).toBe('below_independence');
    });
  });
});
