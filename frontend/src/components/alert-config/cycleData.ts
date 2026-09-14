import type { RTYData } from '../../types';

export type CycleMetric = {
  inputCount: number;
  defectCount: number;
};

export type CycleChartRow = {
  time: string;
  [series: string]: string | number | undefined;
};

export type CycleHeatmapCell = {
  text: string;
  belowTarget?: boolean;
  inputCount?: number;
  defectCount?: number;
};

export type CycleTableRow = {
  model: string;
  cells: Record<string, CycleHeatmapCell>;
  inputCount: number;
  defectCount: number;
};

export function buildCycleVisualData(data: RTYData[], modelTargets: Record<string, number>) {
  const byMonth = new Map<string, Map<string, CycleMetric>>();
  for (const item of data) {
    const month = item.time.substring(0, 7);
    const models = byMonth.get(month) ?? new Map<string, CycleMetric>();
    const current = models.get(item.productModel) ?? { inputCount: 0, defectCount: 0 };
    current.inputCount += item.inputCount;
    current.defectCount += item.defectCount;
    models.set(item.productModel, current);
    byMonth.set(month, models);
  }

  const months = [...byMonth.keys()].sort();
  const models = [...new Set(data.map((item) => item.productModel).filter(Boolean))].sort();
  const trendData: CycleChartRow[] = months.map((month) => {
    const row: CycleChartRow = { time: month };
    const monthData = byMonth.get(month)!;
    for (const model of models) {
      const value = monthData.get(model);
      row[`${model}_input`] = value?.inputCount ?? 0;
      if (value?.inputCount) {
        row[`${model}_rty`] = Number(
          (((value.inputCount - value.defectCount) / value.inputCount) * 100).toFixed(3),
        );
      }
    }
    return row;
  });
  const tableData: CycleTableRow[] = models.map((model) => {
    let inputCount = 0;
    let defectCount = 0;
    const cells = Object.fromEntries(months.map((month) => {
      const value = byMonth.get(month)!.get(model);
      if (!value?.inputCount) return [month, { text: '-' }];
      inputCount += value.inputCount;
      defectCount += value.defectCount;
      const rty = ((value.inputCount - value.defectCount) / value.inputCount) * 100;
      return [month, {
        text: `${rty.toFixed(3)}% (${value.defectCount}/${value.inputCount})`,
        belowTarget: rty < (modelTargets[model] ?? 100),
        inputCount: value.inputCount,
        defectCount: value.defectCount,
      }];
    }));
    return { model, cells, inputCount, defectCount };
  });

  return { trendData, trendModels: models, tableData, allMonths: months };
}
