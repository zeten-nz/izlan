import { describe, it, expect } from 'vitest';
import { slugify, isValidSlug } from './slug';

describe('slugify (Subject create UX)', () => {
  it('SLUG-01 "Tarix Fani" → "tarix-fani"', () => {
    expect(slugify('Tarix Fani')).toBe('tarix-fani');
  });
  it('SLUG-02 lowercases, trims, collapses separators, strips edges', () => {
    expect(slugify('  English   Language  ')).toBe('english-language');
    expect(slugify('A -- B')).toBe('a-b');
    expect(slugify('Physics 101')).toBe('physics-101');
    expect(slugify("O'zbek tili")).toBe('ozbek-tili'); // apostrophe dropped
  });
  it('SLUG-03 non-Latin input yields an empty slug (user must type one)', () => {
    expect(slugify('Тарих')).toBe('');
    expect(slugify('   ')).toBe('');
  });
  it('SLUG-04 every non-empty slugify result passes the backend slug rule', () => {
    for (const s of ['Tarix Fani', 'English', 'A -- B', 'Physics 101', 'Ona tili & adabiyot']) {
      const out = slugify(s);
      if (out.length > 0) expect(isValidSlug(out)).toBe(true);
    }
  });
  it('SLUG-05 isValidSlug rejects uppercase / spaces / leading hyphen', () => {
    expect(isValidSlug('Tarix')).toBe(false);
    expect(isValidSlug('tarix fani')).toBe(false);
    expect(isValidSlug('-tarix')).toBe(false);
    expect(isValidSlug('tarix-fani')).toBe(true);
    expect(isValidSlug('')).toBe(false);
  });
});
