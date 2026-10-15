import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { RTYTemplateExport } from '../../types/rty';
import { buildTemplateWorkbook } from './templateExport';

const empty: RTYTemplateExport = { summary: [], orders: [], faults: [], topProblems: [] };

describe('RTY template workbook', () => {
  it('keeps all four sheets and complete headers when no records match', () => {
    const workbook = buildTemplateWorkbook(empty);

    expect(workbook.SheetNames).toEqual([
      '直通率', '销售订单-分母', '维修故障明记录-分子', 'TOP问题',
    ]);
    const summary = workbook.Sheets['直通率'];
    expect(summary.A1.v).toBe('机型');
    expect(summary.S1.v).toBe('最终直通率');
    expect(summary['!ref']).toBe('A1:S1');
    const orders = workbook.Sheets['销售订单-分母'];
    expect(orders.A1.v).toBe('数据字段按如下顺序显示');
    expect(orders.A2.v).toBe('销售订单');
    expect(orders.R2.v).toBe('最终用户');
    const faults = workbook.Sheets['维修故障明记录-分子'];
    expect(faults.A2.v).toBe('生产基地');
    expect(faults.AH2.v).toBe('RMA复判结论');
    const top = workbook.Sheets['TOP问题'];
    expect(top.A1.v).toBe('序号');
    expect(top.L1.v).toBe('整机故障率');
    expect(top['!ref']).toBe('A1:L1');
  });

  it('round trips typed percentages, leading-zero identifiers, zeros and unavailable fields', () => {
    const workbook = buildTemplateWorkbook({
      ...empty,
      summary: [{ model: 'M', completedQuantity: 10, defectCount: 0, completionRate: 1 }],
      orders: [{ AUFNR: '000000000001', WMENG: 0 }],
      faults: [{ PCODE: '=literal-sn', U_FIX: '张三', ZUSER: 'different-person' }],
      topProblems: [{ serialCount: 0, machineFaultRate: 0 }],
    });
    const result = XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), {
      type: 'buffer', cellNF: true,
    });

    expect(result.Sheets['直通率'].F2).toMatchObject({ t: 'n', v: 1, z: '0.00%' });
    expect(result.Sheets['直通率'].E2).toBeUndefined();
    expect(result.Sheets['直通率'].S2).toBeUndefined();
    expect(result.Sheets['销售订单-分母'].C3).toMatchObject({ t: 's', v: '000000000001' });
    expect(result.Sheets['销售订单-分母'].J3).toMatchObject({ t: 'n', v: 0 });
    expect(result.Sheets['维修故障明记录-分子'].E3).toMatchObject({ t: 's', v: '=literal-sn' });
    expect(result.Sheets['维修故障明记录-分子'].E3.f).toBeUndefined();
    expect(result.Sheets['维修故障明记录-分子'].K3.v).toBe('张三');
    expect(result.Sheets['维修故障明记录-分子'].L3).toBeUndefined();
    expect(result.Sheets['TOP问题'].H2).toBeUndefined();
    expect(result.Sheets['TOP问题'].L2).toMatchObject({ t: 'n', v: 0, z: '0.00%' });
  });
});
