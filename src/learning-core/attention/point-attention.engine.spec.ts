import { derivePointAttention, type SkillAttentionInput } from './point-attention.engine';

const s = (skillId: string, activeSignalTypes: string[] = [], reviewDue = false): SkillAttentionInput => ({ skillId, activeSignalTypes, reviewDue });

describe('Point-Attention engine (point-attention-v1)', () => {
  it('is NONE when no required skill has a signal or is retention-due', () => {
    const r = derivePointAttention([s('a'), s('b')]);
    expect(r.attention).toBe('NONE');
    expect(r.reasonCode).toBe('NONE');
    expect(r.reasonSkillId).toBeNull();
  });

  it('REPAIR_REQUIRED from a REPEATED_MISTAKE signal (concrete misconception), naming the driving skill', () => {
    const r = derivePointAttention([s('a'), s('b', ['REPEATED_MISTAKE'])]);
    expect(r.attention).toBe('REPAIR_REQUIRED');
    expect(r.reasonCode).toBe('REPEATED_MISTAKE');
    expect(r.reasonSkillId).toBe('b');
    expect(r.signalTypes).toContain('REPEATED_MISTAKE');
  });

  it('REPAIR_REQUIRED from a WEAK_SKILL signal (persistent weakness)', () => {
    const r = derivePointAttention([s('a', ['WEAK_SKILL'])]);
    expect(r.attention).toBe('REPAIR_REQUIRED');
    expect(r.reasonCode).toBe('PERSISTENT_WEAKNESS');
    expect(r.reasonSkillId).toBe('a');
  });

  it('repeated-mistake takes reason precedence over a bare weak-skill (clearer learner explanation)', () => {
    const r = derivePointAttention([s('a', ['WEAK_SKILL']), s('b', ['REPEATED_MISTAKE'])]);
    expect(r.reasonCode).toBe('REPEATED_MISTAKE');
    expect(r.reasonSkillId).toBe('b');
    expect(r.signalTypes.sort()).toEqual(['REPEATED_MISTAKE', 'WEAK_SKILL']);
  });

  it('REPAIR outranks REVIEW — a real gap is more urgent than a freshness nudge', () => {
    const r = derivePointAttention([s('a', ['REVIEW_DUE'], true), s('b', ['REPEATED_MISTAKE'])]);
    expect(r.attention).toBe('REPAIR_REQUIRED');
  });

  it('REVIEW_DUE from read-time retention (no persisted signal needed)', () => {
    const r = derivePointAttention([s('a', [], true)]);
    expect(r.attention).toBe('REVIEW_DUE');
    expect(r.reasonCode).toBe('RETENTION_DUE');
    expect(r.reasonSkillId).toBe('a');
  });

  it('REVIEW_DUE also from a persisted REVIEW_DUE signal', () => {
    const r = derivePointAttention([s('a', ['REVIEW_DUE'], false)]);
    expect(r.attention).toBe('REVIEW_DUE');
  });
});
