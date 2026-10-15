import { describe, expect, it } from 'vitest';
import { buildCycleVisualData } from './cycleData';

describe('buildCycleVisualData', () => {
  it('aggregates monthly model quantities and preserves missing RTY values', () => {
    const result = buildCycleVisualData([
      { time: '2026-01-01', productModel: 'A', inputCount: 10, defectCount: 1 },
      { time: '2026-01-15', productModel: 'A', inputCount: 20, defectCount: 2 },
      { time: '2026-02-01', productModel: 'B', inputCount: 5, defectCount: 1 },
    ] as never[], { A: 95 });

    expect(result.trendModels).toEqual(['A', 'B']);
    expect(result.trendData[0]).toMatchObject({ time: '2026-01', A_input: 30, A_rty: 90, B_input: 0 });
    expect(result.trendData[0].B_rty).toBeUndefined();
    expect(result.tableData[0].cells['2026-01']).toEqual({
      text: '90.000% (3/30)',
      belowTarget: true,
      inputCount: 30,
      defectCount: 3,
    });
    expect(result.tableData[0]).toMatchObject({ inputCount: 30, defectCount: 3 });
    expect(result.monthlyData[0]).toEqual({
      month: '2026-01', model: 'A', inputCount: 30, defectCount: 3, targetRate: 95, rtyRate: 90,
    });
  });

  it('retains total quantities so RTY summaries can use a weighted rate', () => {
    const result = buildCycleVisualData([
      { time: '2026-01-01', productModel: 'A', inputCount: 50, defectCount: 11 },
      { time: '2026-02-01', productModel: 'A', inputCount: 1120, defectCount: 128 },
    ] as never[], { A: 95 });

    expect(result.tableData[0]).toMatchObject({ inputCount: 1170, defectCount: 139 });
    expect(((1170 - 139) / 1170 * 100).toFixed(2)).toBe('88.12');
  });

  it('uses server targets and keeps zero input rates absent in chart and export', () => {
    const result = buildCycleVisualData([
      { time: '2026-01-01', productModel: 'A', inputCount: 10, defectCount: 1, targetRate: 85 },
      { time: '2026-02-01', productModel: 'A', inputCount: 0, defectCount: 0, targetRate: 85 },
    ] as never[], {});

    expect(result.tableData[0].cells['2026-01'].belowTarget).toBe(false);
    expect(result.monthlyData[1].rtyRate).toBeNull();
    expect(result.trendData[1].A_rty).toBeUndefined();
  });
});
