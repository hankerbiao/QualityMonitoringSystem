import type { RepairQualitySummary } from '../types/rty';

export const REPAIR_CHART_COLORS = ['#0f766e', '#ea580c', '#2563eb', '#7c3aed', '#db2777', '#65a30d', '#0891b2', '#ca8a04', '#64748b'];

export function buildRepairQualityChartData(summary: RepairQualitySummary) {
  const distribution = summary.distribution.map(item => ({
    ...item,
    label: item.repairCount === '9+' ? '9次+' : `${item.repairCount}次`,
  }));
  return {
    distribution,
    composition: distribution.map((item, index) => ({
      name: item.label,
      value: item.snCount,
      percentage: item.percentage,
      color: REPAIR_CHART_COLORS[index % REPAIR_CHART_COLORS.length],
    })),
  };
}
