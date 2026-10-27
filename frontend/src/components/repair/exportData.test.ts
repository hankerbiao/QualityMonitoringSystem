import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { FAULT_COLUMNS, ORDER_COLUMNS } from '../rty/templateExport';
import { buildRepairQualityWorkbook } from './exportData';
import type { RepairQualityExport } from '../../types';

function fixture(): RepairQualityExport {
  const summary = {
    snCount: 3, firstPassCount: 2, repeatCount: 1, firstPassRate: 66.67,
    distribution: [
      { repairCount: '9+', snCount: 1, percentage: 33.33 },
      { repairCount: '1', snCount: 2, percentage: 66.67 },
    ],
  };
  return {
    summary: { ...summary, groups: [{ ...summary, customer: '00001', base: '天津' }] },
    orders: [{ VBELN: '0000123', AUFNR: '000000001', packagingQuantity: 0 }],
    faults: [{ PCODE: '00001', T_FIND: '2025-01-01', ERROR_MSG: '=literal' }],
  };
}

describe('repair quality Excel export', () => {
  it('reuses RTY/station raw sheets and exports numeric counts and percentages', () => {
    const data = fixture();
    // An SN can belong to multiple customer/base groups; totals must not be summed.
    data.summary.groups.push({ ...data.summary.groups[0], base: '昆山' });
    const book = buildRepairQualityWorkbook(data);
    const result = XLSX.read(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), {
      type: 'buffer', cellNF: true,
    });
    expect(result.SheetNames).toEqual(['维修通过率分析表', '销售订单', '维修故障明细记录']);
    const sheet = result.Sheets['维修通过率分析表'];
    expect(sheet.A2).toMatchObject({ t: 's', v: '00001' });
    expect(sheet.C2).toMatchObject({ t: 'n', v: 3 });
    expect(sheet.D2).toMatchObject({ t: 'n', z: '0.00%' });
    expect(sheet.D2.v).toBeCloseTo(0.6667, 10);
    expect(sheet.E2.v).toBe(2);
    expect(sheet.G2.v).toBe(0);
    expect(sheet.U2.v).toBe(1);
    expect(sheet.V2).toMatchObject({ t: 'n', z: '0.00%' });
    expect(sheet.V2.v).toBeCloseTo(0.3333, 10);
    expect(sheet.C4.v).toBe(3);
    expect(sheet['!autofilter']?.ref).toBe('A1:V3');
    expect(XLSX.utils.sheet_to_json(result.Sheets['销售订单'], { header: 1 })[0]).toEqual(ORDER_COLUMNS.map(([, label]) => label));
    expect(XLSX.utils.sheet_to_json(result.Sheets['维修故障明细记录'], { header: 1 })[0]).toEqual(FAULT_COLUMNS.map(([, label]) => label));
    expect(result.Sheets['销售订单'].A2).toMatchObject({ t: 's', v: '0000123' });
    expect(result.Sheets['销售订单'].J2.v).toBe(0);
    expect(result.Sheets['维修故障明细记录'].E2.v).toBe('00001');
    expect(result.Sheets['维修故障明细记录'].AB2).toMatchObject({ t: 's', v: '=literal' });
    expect(result.Sheets['维修故障明细记录'].AB2.f).toBeUndefined();
  });

  it('retains complete headers and zero totals for empty results', () => {
    const book = buildRepairQualityWorkbook({
      summary: { snCount: 0, firstPassCount: 0, repeatCount: 0, firstPassRate: 0, distribution: [], groups: [] },
      orders: [], faults: [],
    });
    expect(book.Sheets['维修通过率分析表'].V1.v).toBe('9次+占比');
    expect(book.Sheets['维修通过率分析表'].C2.v).toBe(0);
    expect(book.Sheets['维修通过率分析表'].D2.v).toBe(0);
    expect(book.Sheets['销售订单']['!ref']).toBe('A1:R1');
    expect(book.Sheets['维修故障明细记录']['!ref']).toBe('A1:AI1');
  });
});
