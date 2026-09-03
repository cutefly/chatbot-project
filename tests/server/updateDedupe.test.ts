import { describe, it, expect } from 'vitest';
import { createUpdateDedupe } from '../../src/server/updateDedupe.js';

describe('UpdateDedupe', () => {
  it('returns true for a brand-new update id', () => {
    const dedupe = createUpdateDedupe();
    expect(dedupe.claim(1)).toBe(true);
  });

  it('returns false when the same id is claimed twice', () => {
    const dedupe = createUpdateDedupe();
    expect(dedupe.claim(1)).toBe(true);
    expect(dedupe.claim(1)).toBe(false);
  });

  it('returns true for distinct ids', () => {
    const dedupe = createUpdateDedupe();
    expect(dedupe.claim(1)).toBe(true);
    expect(dedupe.claim(2)).toBe(true);
    expect(dedupe.claim(3)).toBe(true);
  });

  it('evicts the oldest id once the size bound is exceeded', () => {
    const dedupe = createUpdateDedupe(3);
    expect(dedupe.claim(1)).toBe(true);
    expect(dedupe.claim(2)).toBe(true);
    expect(dedupe.claim(3)).toBe(true);
    // Size now at bound; claiming 4 should evict 1
    expect(dedupe.claim(4)).toBe(true);
    // 1 was evicted, so claiming it again returns true
    expect(dedupe.claim(1)).toBe(true);
    // 4 is still in the set, so claiming it again returns false
    expect(dedupe.claim(4)).toBe(false);
  });

  it('does not grow without bound', () => {
    const dedupe = createUpdateDedupe(3);
    for (let i = 1; i <= 100; i++) {
      dedupe.claim(i);
    }
    // Most recent ids (98, 99, 100) should still be remembered
    expect(dedupe.claim(98)).toBe(false);
    expect(dedupe.claim(99)).toBe(false);
    expect(dedupe.claim(100)).toBe(false);
    // Early id (1) should have been evicted long ago
    expect(dedupe.claim(1)).toBe(true);
  });
});
