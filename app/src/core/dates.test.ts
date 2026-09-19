import { describe, it, expect } from 'vitest';
import { addDays, addMonths, dayLabel, daysBetween, inferYear, isoFromDayMon, isoFromDmy, monthOf, parseDayMonYear, sgtDate } from './dates';

describe('dates', () => {
  it('reads dd/mm/yyyy', () => {
    expect(isoFromDmy('01/08/2026')).toBe('2026-08-01');
    expect(isoFromDmy('31/12/2025')).toBe('2025-12-31');
    expect(isoFromDmy('1/8/2026')).toBeNull();
    expect(isoFromDmy('32/01/2026')).toBeNull();
  });
  it('reads "dd Mon" with a given year, in any case', () => {
    expect(isoFromDayMon('22 JUL', 2026)).toBe('2026-07-22');
    expect(isoFromDayMon('01 Feb', 2026)).toBe('2026-02-01');
    expect(isoFromDayMon('9 Aug', 2026)).toBe('2026-08-09');
    expect(isoFromDayMon('30 Feb', 2026)).toBeNull();
    expect(isoFromDayMon('01 Foo', 2026)).toBeNull();
  });
  it('reads "dd Mon yyyy"', () => {
    expect(parseDayMonYear('20 AUG 2026')).toBe('2026-08-20');
    expect(parseDayMonYear('28 Feb 2026')).toBe('2026-02-28');
    expect(parseDayMonYear('Aug 2026')).toBeNull();
  });
  it('rolls the year back for months after the statement month', () => {
    expect(inferYear(12, 2026, 1)).toBe(2025);
    expect(inferYear(1, 2026, 1)).toBe(2026);
    expect(inferYear(7, 2026, 8)).toBe(2026);
  });
  it('converts timestamps to SGT dates and labels days', () => {
    expect(sgtDate('2026-09-18T16:30:00.000Z')).toBe('2026-09-19');
    expect(sgtDate('2026-09-18T15:59:00.000Z')).toBe('2026-09-18');
    expect(dayLabel('2026-09-19')).toBe('19 Sep 2026');
    expect(dayLabel('2026-02-01')).toBe('1 Feb 2026');
  });
  it('does month and day arithmetic on ISO strings', () => {
    expect(monthOf('2026-08-20')).toBe('2026-08');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addMonths('2026-08', -1)).toBe('2026-07');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2025-12', 2)).toBe('2026-02');
    expect(daysBetween('2026-08-01', '2026-08-04')).toBe(3);
  });
});
