import type { RepairQualitySummary } from '../types/rty';

export const REPAIR_CHART_COLORS = ['#0f766e', '#ea580c', '#2563eb', '#7c3aed', '#db2777', '#65a30d', '#0891b2', '#ca8a04', '#64748b'];

export function buildRepairQualityChartData(summary: RepairQualitySummary) {
  const distribution = summary.distribution.map(item => ({
    ...item,
    label: item.repairCount === '9+' ? '9次+' : `${item.repairCount}次`,
  }));
  let cumulativeCount = 0;
  const cumulative = distribution
    .filter(item => /^[1-8]$/.test(item.repairCount))
    .sort((left, right) => Number(left.repairCount) - Number(right.repairCount))
    .map(item => {
      cumulativeCount += item.snCount;
      return {
        label: item.label,
        snCount: cumulativeCount,
        percentage: summary.snCount > 0 ? cumulativeCount / summary.snCount * 100 : 0,
      };
    });
  const ranking = [...summary.groups]
    .sort((left, right) => right.repeatCount - left.repeatCount
      || right.snCount - left.snCount
      || left.customer.localeCompare(right.customer, 'zh-CN')
      || left.base.localeCompare(right.base, 'zh-CN'))
    .slice(0, 5)
    .map(group => ({
      ...group,
      label: `${group.customer} / ${group.base}`,
      repeatRate: group.snCount > 0 ? group.repeatCount / group.snCount * 100 : 0,
    }));

  return {
    distribution,
    cumulative,
    ranking,
    composition: [
      { name: '首修通过', value: summary.firstPassCount, color: REPAIR_CHART_COLORS[0] },
      { name: '发生复修', value: summary.repeatCount, color: REPAIR_CHART_COLORS[1] },
    ],
  };
}
