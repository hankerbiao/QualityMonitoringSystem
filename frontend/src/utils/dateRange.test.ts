import { describe, expect, it } from 'vitest';
import { dateRangePresets, formatLocalDate, recentDateRange } from './dateRange';

describe('date range shortcuts', () => {
  it('uses inclusive local dates for recent ranges without UTC conversion', () => {
    const now = new Date(2026, 9, 26, 0, 15);
    expect(formatLocalDate(now)).toBe('2026-10-26');
    expect(recentDateRange(7, now)).toEqual({ from: '2026-10-20', to: '2026-10-26' });
    expect(recentDateRange(30, now)).toEqual({ from: '2026-09-27', to: '2026-10-26' });
  });

  it('provides Monday-based weeks and bounds current periods at today', () => {
    const presets = Object.fromEntries(dateRangePresets(new Date(2026, 9, 28)).map(({ label, ...value }) => [label, value]));
    expect(presets['今天']).toEqual({ from: '2026-10-28', to: '2026-10-28' });
    expect(presets['昨天']).toEqual({ from: '2026-10-27', to: '2026-10-27' });
    expect(presets['本周']).toEqual({ from: '2026-10-26', to: '2026-10-28' });
    expect(presets['上周']).toEqual({ from: '2026-10-19', to: '2026-10-25' });
    expect(presets['本月']).toEqual({ from: '2026-10-01', to: '2026-10-28' });
    expect(presets['上月']).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(presets['本季度']).toEqual({ from: '2026-10-01', to: '2026-10-28' });
    expect(presets['今年']).toEqual({ from: '2026-01-01', to: '2026-10-28' });
  });

  it('handles year boundaries, Sundays and leap-year month ends', () => {
    const january = dateRangePresets(new Date(2027, 0, 1));
    expect(january.find(item => item.label === '上月')).toMatchObject({ from: '2026-12-01', to: '2026-12-31' });
    expect(january.find(item => item.label === '本周')).toMatchObject({ from: '2026-12-28', to: '2027-01-01' });
    expect(dateRangePresets(new Date(2026, 9, 25)).find(item => item.label === '本周')).toMatchObject({ from: '2026-10-19', to: '2026-10-25' });
    expect(dateRangePresets(new Date(2024, 2, 1)).find(item => item.label === '上月')).toMatchObject({ from: '2024-02-01', to: '2024-02-29' });
  });
});
