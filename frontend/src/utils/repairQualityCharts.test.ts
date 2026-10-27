import { describe, expect, it } from 'vitest';
import type { RepairQualitySummary } from '../types/rty';
import { buildRepairQualityChartData } from './repairQualityCharts';

function summary(): RepairQualitySummary {
  return {
    snCount: 10, firstPassCount: 5, repeatCount: 5, firstPassRate: 50,
    distribution: [
      { repairCount: '2', snCount: 3, percentage: 30 },
      { repairCount: '1', snCount: 5, percentage: 50 },
      ...Array.from({ length: 6 }, (_, index) => ({ repairCount: String(index + 3), snCount: 0, percentage: 0 })),
      { repairCount: '9+', snCount: 2, percentage: 20 },
    ],
    groups: [],
  };
}

describe('repair quality chart data', () => {
  it('preserves each bucket count and percentage for the distribution chart', () => {
    const data = buildRepairQualityChartData(summary());
    expect(data.distribution[0]).toEqual({ repairCount: '2', label: '2次', snCount: 3, percentage: 30 });
    expect(data.distribution[1]).toEqual({ repairCount: '1', label: '1次', snCount: 5, percentage: 50 });
    expect(data.distribution.at(-1)).toEqual({ repairCount: '9+', label: '9次+', snCount: 2, percentage: 20 });
  });

  it('splits the pie into the same repair-count buckets including 9+', () => {
    const { composition } = buildRepairQualityChartData(summary());
    expect(composition.map(({ name, value, percentage }) => ({ name, value, percentage }))).toEqual([
      { name: '2次', value: 3, percentage: 30 },
      { name: '1次', value: 5, percentage: 50 },
      ...Array.from({ length: 6 }, (_, index) => ({ name: `${index + 3}次`, value: 0, percentage: 0 })),
      { name: '9次+', value: 2, percentage: 20 },
    ]);
  });

  it('keeps empty results finite and preserves all-first-pass and all-repeat cases', () => {
    const source = summary();
    const empty = buildRepairQualityChartData({ ...source, snCount: 0, firstPassCount: 0, repeatCount: 0, distribution: source.distribution.map(item => ({ ...item, snCount: 0, percentage: 0 })) });
    expect(empty.distribution.every(item => item.percentage === 0)).toBe(true);
    expect(empty.composition.every(item => item.value === 0 && item.percentage === 0)).toBe(true);
  });
});
