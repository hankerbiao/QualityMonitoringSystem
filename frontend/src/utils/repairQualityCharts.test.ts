import { describe, expect, it } from 'vitest';
import type { RepairQualityGroup, RepairQualitySummary } from '../types/rty';
import { buildRepairQualityChartData } from './repairQualityCharts';

function group(customer: string, repeatCount: number, snCount: number): RepairQualityGroup {
  return {
    customer, base: '天津', repeatCount, snCount,
    firstPassCount: snCount - repeatCount,
    firstPassRate: snCount ? (snCount - repeatCount) / snCount * 100 : 0,
    distribution: [],
  };
}

function summary(groups: RepairQualityGroup[] = []): RepairQualitySummary {
  return {
    snCount: 10, firstPassCount: 5, repeatCount: 5, firstPassRate: 50,
    distribution: [
      { repairCount: '2', snCount: 3, percentage: 30 },
      { repairCount: '1', snCount: 5, percentage: 50 },
      ...Array.from({ length: 6 }, (_, index) => ({ repairCount: String(index + 3), snCount: 0, percentage: 0 })),
      { repairCount: '9+', snCount: 2, percentage: 20 },
    ],
    groups,
  };
}

describe('repair quality chart data', () => {
  it('calculates ordered cumulative coverage from counts and excludes the open-ended bucket', () => {
    const data = buildRepairQualityChartData(summary());
    expect(data.cumulative).toHaveLength(8);
    expect(data.cumulative[0]).toEqual({ label: '1次', snCount: 5, percentage: 50 });
    expect(data.cumulative[1]).toEqual({ label: '2次', snCount: 8, percentage: 80 });
    expect(data.cumulative[7]).toEqual({ label: '8次', snCount: 8, percentage: 80 });
    expect(data.distribution.at(-1)?.label).toBe('9次+');
  });

  it('ranks the top five groups by repeat volume, then SN volume, without changing source rows', () => {
    const rows = [group('低复修', 1, 100), group('第三', 6, 10), group('首位', 8, 9), group('第二', 6, 20), group('第四', 4, 8), group('第五', 3, 4)];
    const originalOrder = rows.map(row => row.customer);
    const { ranking } = buildRepairQualityChartData(summary(rows));
    expect(ranking.map(row => row.customer)).toEqual(['首位', '第二', '第三', '第四', '第五']);
    expect(ranking[1].repeatRate).toBe(30);
    expect(rows.map(row => row.customer)).toEqual(originalOrder);
  });

  it('keeps empty results finite and preserves all-first-pass and all-repeat cases', () => {
    const source = summary();
    const empty = buildRepairQualityChartData({ ...source, snCount: 0, firstPassCount: 0, repeatCount: 0, distribution: source.distribution.map(item => ({ ...item, snCount: 0, percentage: 0 })) });
    expect(empty.cumulative.every(item => item.percentage === 0)).toBe(true);
    expect(empty.ranking).toEqual([]);
    expect(buildRepairQualityChartData({ ...source, firstPassCount: 10, repeatCount: 0 }).composition.map(item => item.value)).toEqual([10, 0]);
    expect(buildRepairQualityChartData({ ...source, firstPassCount: 0, repeatCount: 10 }).composition.map(item => item.value)).toEqual([0, 10]);
  });
});
