import {
  DEFAULT_PLACEMENT_THRESHOLDS as T,
  classifySkill,
  classifyPoints,
  domainBands,
  overallBand,
  decideLevel,
  type SkillDiagnostic,
} from './placement-v2.engine';

const m = (skillId: string, masteryScoreBp: number, evidenceCount = 1, confidenceBp = 10000): SkillDiagnostic => ({ skillId, masteryScoreBp, confidenceBp, evidenceCount });

describe('Placement V2 engine (pure, placementThresholdPolicy/v1)', () => {
  describe('classifySkill', () => {
    it('is UNASSESSED with no evidence — absence, never a 0 band', () => {
      expect(classifySkill(undefined, T)).toBe('UNASSESSED');
      expect(classifySkill(m('s', 10000, 0), T)).toBe('UNASSESSED'); // evidenceCount below minEvidenceCount
    });
    it('VALIDATED at/above validateBp with sufficient evidence', () => {
      expect(classifySkill(m('s', T.validateBp), T)).toBe('VALIDATED');
      expect(classifySkill(m('s', 10000), T)).toBe('VALIDATED');
    });
    it('WEAK below continueBp; COMPETENT in the middle band', () => {
      expect(classifySkill(m('s', T.continueBp - 1), T)).toBe('WEAK');
      expect(classifySkill(m('s', T.continueBp), T)).toBe('COMPETENT');
      expect(classifySkill(m('s', T.validateBp - 1), T)).toBe('COMPETENT');
    });
  });

  describe('classifyPoints', () => {
    const points = [{ roadmapPointId: 'p', requiredSkillIds: ['a', 'b'] }];
    it('VALIDATED only when every required skill is validated', () => {
      const byId = new Map([['a', m('a', 10000)], ['b', m('b', 10000)]]);
      expect(classifyPoints(points, byId, T)[0].outcome).toBe('VALIDATED');
    });
    it('WEAK if any required skill is weak — a validated sibling does not hide the gap', () => {
      const byId = new Map([['a', m('a', 10000)], ['b', m('b', 100)]]);
      expect(classifyPoints(points, byId, T)[0].outcome).toBe('WEAK');
    });
    it('UNASSESSED when no required skill has evidence (never silently validated)', () => {
      expect(classifyPoints(points, new Map(), T)[0].outcome).toBe('UNASSESSED');
    });
    it('AVAILABLE for a partial/mixed measurement that is neither all-validated nor weak nor all-unassessed', () => {
      const byId = new Map([['a', m('a', 10000)]]); // b unassessed, a validated → mixed
      expect(classifyPoints(points, byId, T)[0].outcome).toBe('AVAILABLE');
    });
  });

  describe('domainBands', () => {
    const skillDomain = new Map([['g1', 'GRAMMAR'], ['g2', 'GRAMMAR'], ['v1', 'VOCABULARY']]);
    it('marks a domain MEASURED with a weighted band, and one with no evidence NOT_ASSESSED (band null)', () => {
      const measured = [m('g1', 8000), m('g2', 6000)]; // vocabulary has no evidence
      const bands = domainBands(['GRAMMAR', 'VOCABULARY', 'LISTENING'], skillDomain, measured, T);
      const grammar = bands.find((b) => b.domainCode === 'GRAMMAR')!;
      const vocab = bands.find((b) => b.domainCode === 'VOCABULARY')!;
      const listening = bands.find((b) => b.domainCode === 'LISTENING')!;
      expect(grammar.state).toBe('MEASURED');
      expect(grammar.bandBp).toBe(7000); // equal weights → mean
      expect(vocab.state).toBe('NOT_ASSESSED');
      expect(vocab.bandBp).toBeNull();
      expect(listening.state).toBe('NOT_ASSESSED'); // no skills map to it at all
    });
    it('weights by evidenceCount × confidenceBp so thin evidence cannot swing a band', () => {
      const measured = [m('g1', 10000, 10, 10000), m('g2', 0, 1, 10000)];
      const band = domainBands(['GRAMMAR'], skillDomain, measured, T)[0].bandBp!;
      expect(band).toBeGreaterThan(9000); // dominated by the 10-evidence skill, not the mean (5000)
    });
  });

  describe('overallBand + decideLevel', () => {
    it('overallBand is null when nothing is measured', () => {
      expect(overallBand([], T)).toBeNull();
    });
    it('LEVEL_VALIDATED requires a high overall AND required-domain sufficiency AND no weak point', () => {
      expect(decideLevel(10000, true, false, T)).toBe('LEVEL_VALIDATED');
      expect(decideLevel(10000, true, true, T)).toBe('CONTINUE_WITH_REPAIR'); // a weak point blocks validation
      expect(decideLevel(10000, false, false, T)).toBe('CONTINUE_WITH_REPAIR'); // a required domain wasn't sufficient
    });
    it('bands down through CONTINUE_WITH_REPAIR / REBUILD_LEVEL / PREREQUISITE_FALLBACK', () => {
      expect(decideLevel(T.continueBp, true, true, T)).toBe('CONTINUE_WITH_REPAIR');
      expect(decideLevel(T.rebuildBp, true, true, T)).toBe('REBUILD_LEVEL');
      expect(decideLevel(T.rebuildBp - 1, true, true, T)).toBe('PREREQUISITE_FALLBACK');
      expect(decideLevel(null, true, true, T)).toBe('PREREQUISITE_FALLBACK');
    });
  });
});
