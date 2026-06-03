import { describe, it, expect } from 'vitest';
import { buildZonedIso, isValidTimeZone } from '../../src/server/time.js';

describe('isValidTimeZone', () => {
  it('returns true for a valid IANA timezone', () => {
    expect(isValidTimeZone('Asia/Seoul')).toBe(true);
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
  });

  it('returns false for an invalid timezone', () => {
    expect(isValidTimeZone('Invalid/Zone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('Seoul')).toBe(false);
  });
});

describe('buildZonedIso', () => {
  it('formats a fixed instant into Asia/Seoul wall-clock with +09:00 offset', () => {
    // 2026-06-02T01:00:00Z === 2026-06-02 10:00:00 in Asia/Seoul (UTC+9, no DST)
    const instant = new Date('2026-06-02T01:00:00Z');
    expect(buildZonedIso('Asia/Seoul', instant)).toBe('2026-06-02T10:00:00+09:00');
  });

  it('formats the same instant into America/New_York wall-clock with -04:00 (EDT)', () => {
    // 2026-06-02T01:00:00Z === 2026-06-01 21:00:00 in New York (EDT, UTC-4)
    const instant = new Date('2026-06-02T01:00:00Z');
    expect(buildZonedIso('America/New_York', instant)).toBe('2026-06-01T21:00:00-04:00');
  });

  it('uses Z for UTC', () => {
    const instant = new Date('2026-06-02T01:00:00Z');
    expect(buildZonedIso('UTC', instant)).toBe('2026-06-02T01:00:00+00:00');
  });

  it('throws for an invalid timezone', () => {
    expect(() => buildZonedIso('Invalid/Zone', new Date())).toThrow();
  });
});
