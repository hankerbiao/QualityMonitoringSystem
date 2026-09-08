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
    });
  });
});
