import { describe, it, expect } from 'vitest';
import { parseBrDateToYmd, weekRangeYmd, isInCurrentWeek } from '../src/week';

describe('parseBrDateToYmd', () => {
  it('parses DD/MM/YYYY with time', () => {
    expect(parseBrDateToYmd('21/07/2026 14:30:00')).toBe(20260721);
  });

  it('parses date only', () => {
    expect(parseBrDateToYmd('01/02/2025')).toBe(20250201);
  });

  it('invalid returns null', () => {
    expect(parseBrDateToYmd('')).toBeNull();
    expect(parseBrDateToYmd('nope')).toBeNull();
    expect(parseBrDateToYmd('2025-02-01')).toBeNull();
  });
});

describe('weekRangeYmd', () => {
  // Tue 2026-07-21 12:00 UTC -> SP week Mon 20 .. Sun 26
  it('Tuesday maps to Mon..Sun of that week', () => {
    const now = new Date('2026-07-21T12:00:00Z');
    expect(weekRangeYmd(now)).toEqual({ start: 20260720, end: 20260726 });
  });

  it('Monday is start of its own week', () => {
    const now = new Date('2026-07-20T12:00:00Z');
    expect(weekRangeYmd(now)).toEqual({ start: 20260720, end: 20260726 });
  });

  it('Sunday is end of its own week', () => {
    const now = new Date('2026-07-26T12:00:00Z');
    expect(weekRangeYmd(now)).toEqual({ start: 20260720, end: 20260726 });
  });
});

describe('isInCurrentWeek', () => {
  const now = new Date('2026-07-21T12:00:00Z'); // week 20..26

  it('date inside week', () => {
    expect(isInCurrentWeek('20/07/2026 09:00:00', now)).toBe(true);
    expect(isInCurrentWeek('26/07/2026 23:00:00', now)).toBe(true);
  });

  it('date before week', () => {
    expect(isInCurrentWeek('19/07/2026 09:00:00', now)).toBe(false);
  });

  it('date after week', () => {
    expect(isInCurrentWeek('27/07/2026 09:00:00', now)).toBe(false);
  });

  it('invalid date is not in week', () => {
    expect(isInCurrentWeek('lixo', now)).toBe(false);
  });
});
