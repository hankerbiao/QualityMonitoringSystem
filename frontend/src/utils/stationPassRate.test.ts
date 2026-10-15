import { describe, expect, it } from 'vitest';
import {
  combinedStationPassRate,
  datePresetRange,
  matchingDatePreset,
  rankVolumes,
  rowMatchesBand,
  summarizeStationRates,
} from './stationPassRate';

describe('combinedStationPassRate', () => {
  const rows = new Map([
    ['OP10', { passRate: 98 }],
    ['OP20', { passRate: 99 }],
  ]);

  it('multiplies every selected station pass rate', () => {
    expect(combinedStationPassRate(rows, ['OP10', 'OP20'])).toBeCloseTo(97.02);
  });

  it('returns no result without a selection or when a selected station is absent', () => {
    expect(combinedStationPassRate(rows, [])).toBeNull();
    expect(combinedStationPassRate(rows, ['OP10', 'OP30'])).toBeNull();
  });
});

describe('rankVolumes', () => {
  it('keeps the largest volumes and totals the remainder', () => {
    const ranking = rankVolumes([
      { label: 'B', count: 20 },
      { label: '  ', count: 100 },
      { label: 'A', count: 20 },
      { label: 'C', count: 5 },
      { label: 'D', count: 0 },
    ], 2);

    expect(ranking.visible.map((item) => item.label)).toEqual(['A', 'B']);
    expect(ranking.restCount).toBe(1);
    expect(ranking.restVolume).toBe(5);
    expect(ranking.total).toBe(45);
    expect(rankVolumes([
      { label: 'A', count: 30 },
      { label: 'B', count: 20 },
      { label: 'C', count: 10 },
    ], 2, 'C').visible.map((item) => item.label)).toEqual(['A', 'C']);
  });
});

describe('datePresetRange', () => {
  const today = new Date(2026, 8, 23);

  it('matches the page default 30-day window and full calendar months', () => {
    expect(datePresetRange('7d', today)).toEqual({ from: '2026-09-17', to: '2026-09-23' });
    expect(datePresetRange('30d', today)).toEqual({ from: '2026-08-25', to: '2026-09-23' });
    expect(datePresetRange('thisMonth', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(datePresetRange('lastMonth', today)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(datePresetRange('year', today)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(matchingDatePreset('2026-08-25', '2026-09-23', today)).toBe('30d');
    expect(matchingDatePreset('2026-08-01', '2026-08-20', today)).toBeNull();
  });

  it.each([
    { today: new Date(2026, 9, 15, 16, 30), from: '2026-10-05', to: '2026-10-11' },
    { today: new Date(2026, 9, 12), from: '2026-10-05', to: '2026-10-11' },
    { today: new Date(2026, 9, 18), from: '2026-10-05', to: '2026-10-11' },
    { today: new Date(2026, 9, 5), from: '2026-09-28', to: '2026-10-04' },
    { today: new Date(2027, 0, 4), from: '2026-12-28', to: '2027-01-03' },
    { today: new Date(2027, 0, 1), from: '2026-12-21', to: '2026-12-27' },
  ])('selects the previous Monday through Sunday for $today', ({ today, from, to }) => {
    expect(datePresetRange('lastWeek', today)).toEqual({ from, to });
    expect(matchingDatePreset(from, to, today)).toBe('lastWeek');
  });
});

describe('summarizeStationRates', () => {
  const rows = [
    { dimensionValue: 'M1', stationCode: 'OP20', stationName: '测试', inputCount: 100, defectCount: 1, passRate: 99 },
    { dimensionValue: 'M1', stationCode: 'OP10', stationName: '装配', inputCount: 50, defectCount: 4, passRate: 92 },
    { dimensionValue: 'M2', stationCode: 'OP10', stationName: '装配', inputCount: 50, defectCount: 1, passRate: 98 },
    { dimensionValue: 'M2', stationCode: 'OP20', stationName: '测试', inputCount: 40, defectCount: 2, passRate: 95 },
  ];

  it('weights each station across dimensions and ranks the lowest cells', () => {
    const summary = summarizeStationRates(rows, 2);

    expect(summary.counts).toEqual({ met: 2, watch: 1, alert: 1 });
    expect(summary.stations.map((station) => station.stationCode)).toEqual(['OP10', 'OP20']);
    expect(summary.stations[0]).toMatchObject({ inputCount: 100, defectCount: 5, passRate: 95, alertCount: 1, watchCount: 0 });
    expect(summary.lowest.map((row) => `${row.dimensionValue}:${row.stationCode}`)).toEqual(['M1:OP10', 'M2:OP20']);
    expect(rowMatchesBand(rows.filter((row) => row.dimensionValue === 'M1').map((row) => ({ passRate: row.passRate })), 'alert')).toBe(true);
    expect(rowMatchesBand([{ passRate: 99 }, { passRate: 96 }], 'alert')).toBe(false);
  });
});
