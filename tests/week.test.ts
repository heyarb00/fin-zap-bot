import { describe, it, expect } from 'vitest';
import { parseBrDateToYmd, weekRangeYmd, isInCurrentWeek, cellToYmd, cellDateLabel } from '../src/week';

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

describe('cellToYmd / cellDateLabel (serial numbers)', () => {
  // Sheets serial for 2026-07-21 15:30 UTC
  const serial = 25569 + Date.UTC(2026, 6, 21, 15, 30, 0) / 86400000;

  it('cellToYmd from serial', () => {
    expect(cellToYmd(serial)).toBe(20260721);
  });

  it('cellToYmd from string', () => {
    expect(cellToYmd('21/07/2026 15:30:00')).toBe(20260721);
  });

  it('cellDateLabel from serial', () => {
    expect(cellDateLabel(serial)).toBe('21/07 15:30');
  });

  it('cellDateLabel from string', () => {
    expect(cellDateLabel('21/07/2026 15:30:00')).toBe('21/07 15:30');
  });

  it('cellToYmd invalid', () => {
    expect(cellToYmd('lixo')).toBeNull();
    expect(cellToYmd(null)).toBeNull();
  });
});

describe('weekRangeYmd', () => {
  // Tue 2026-07-21 -> SP week Sun 19 .. Sat 25 (Dashboard uses Sunday start)
  it('Tuesday maps to Sun..Sat of that week', () => {
    const now = new Date('2026-07-21T12:00:00Z');
    expect(weekRangeYmd(now)).toEqual({ start: 20260719, end: 20260725 });
  });

  it('Sunday is start of its own week', () => {
    const now = new Date('2026-07-19T12:00:00Z');
    expect(weekRangeYmd(now)).toEqual({ start: 20260719, end: 20260725 });
  });

  it('Saturday is end of its own week', () => {
    const now = new Date('2026-07-25T12:00:00Z');
    expect(weekRangeYmd(now)).toEqual({ start: 20260719, end: 20260725 });
  });
});

describe('isInCurrentWeek', () => {
  const now = new Date('2026-07-21T12:00:00Z'); // week 19..25

  it('date inside week', () => {
    expect(isInCurrentWeek('19/07/2026 09:00:00', now)).toBe(true);
    expect(isInCurrentWeek('25/07/2026 23:00:00', now)).toBe(true);
  });

  it('date before week', () => {
    expect(isInCurrentWeek('18/07/2026 09:00:00', now)).toBe(false);
  });

  it('date after week (next Sunday)', () => {
    expect(isInCurrentWeek('26/07/2026 09:00:00', now)).toBe(false);
  });

  it('invalid date is not in week', () => {
    expect(isInCurrentWeek('lixo', now)).toBe(false);
  });
});
