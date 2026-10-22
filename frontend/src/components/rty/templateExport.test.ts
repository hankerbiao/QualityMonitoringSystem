import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { RTYTemplateExport } from '../../types/rty';
import { appendModelSheets, buildTemplateWorkbook, REPAIR_COLUMNS } from './templateExport';

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
    expect(faults.AI2.v).toBe('订单类型');
    expect(faults.AJ2).toBeUndefined();
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

  it('summarizes repeated phenomena in the legacy fault sheet without dropping detail rows', () => {
    const workbook = buildTemplateWorkbook({
      ...empty,
      faults: [
        { PCODE: 'SN1', ZNGWD3: '问题A' },
        { PCODE: 'SN2', ZNGWD3: '问题B' },
        { PCODE: 'SN3', ZNGWD3: '问题B' },
      ],
    });
    const faults = workbook.Sheets['维修故障明记录-分子'];

    expect(faults.I3.v).toBe('问题A * 1');
    expect(faults.I4.v).toBe('问题B * 2');
    expect(faults.I5).toBeUndefined();
    expect(faults.J3).toBeUndefined();
    expect([faults.E3.v, faults.E4.v, faults.E5.v]).toEqual(['SN1', 'SN2', 'SN3']);
  });

  it('summarizes phenomenon values in integrated source sheets while preserving detail rows', () => {
    const workbook = buildTemplateWorkbook({
      ...empty,
      modelSheets: [],
      faults: [
        { PCODE: 'SN1', ZNGWD3: '问题A' },
        { PCODE: 'SN2', ZNGWD3: '问题B' },
        { PCODE: 'SN3', ZNGWD3: '问题B' },
      ],
    });
    const faults = workbook.Sheets['维修故障明记录'];

    expect(faults.I2.v).toBe('问题A * 1');
    expect(faults.I3.v).toBe('问题B * 2');
    expect(faults.I4).toBeUndefined();
    expect(faults.J2).toBeUndefined();
    expect([faults.E2.v, faults.E3.v, faults.E4.v]).toEqual(['SN1', 'SN2', 'SN3']);
  });
});

describe('integrated repair model sheets', () => {
  it('writes Chinese headers, counted materials and cached Excel formulas', () => {
    const workbook = buildTemplateWorkbook({
      ...empty,
      modelSheets: [{
        model: '6210 C21',
        rows: [{
          sequence: 1, model: '6210 C21', problem: 'first * 1\nsecond * 2\nsecond * 2',
          repairAction: '更换内存', material: 'B5000113*2',
          materialDescription: '=literal-description', materialCount: 2,
          materialUsage: 2400, serialCount: 1, productionQuantity: 1258,
        }],
      }],
    });
    expect(workbook.SheetNames).toEqual(['直通率', '销售订单', '维修故障明记录', '6210 C21']);
    const result = XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), {
      type: 'buffer', cellNF: true,
    });
    const sheet = result.Sheets['6210 C21'];
    expect(XLSX.utils.sheet_to_json(sheet, { header: 1 })[0]).toEqual(
      REPAIR_COLUMNS.map(([, label]) => label),
    );
    expect(sheet.E2.v).toBe('B5000113*2');
    expect(sheet.C2.v).toBe('first * 1\nsecond * 2\nsecond * 2');
    expect(sheet.G1.v).toBe('部件故障计数');
    expect(sheet.G2.v).toBe(2);
    expect(sheet.I2).toMatchObject({ t: 'n', f: 'G2/H2', v: 2 / 2400, z: '0.00%' });
    expect(sheet.L2).toMatchObject({ t: 'n', f: 'J2/K2', v: 1 / 1258, z: '0.00%' });
    expect(sheet.F2).toMatchObject({ t: 's', v: '=literal-description' });
    expect(sheet.F2.f).toBeUndefined();
  });

  it('sorts each model by descending numeric fault count and renumbers rows without changing the source', () => {
    const rows = [2, 10, 2].map((count, index) => ({
      sequence: index + 1, material: `PN${index}*${count}`, materialCount: count,
      materialUsage: 100, serialCount: index + 1, productionQuantity: 50,
    }));
    const workbook = XLSX.utils.book_new();
    appendModelSheets(workbook, [
      { model: 'M', rows },
      { model: 'Other', rows: [rows[0], rows[1]] },
    ]);
    const result = XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), {
      type: 'buffer',
    });
    const sheet = result.Sheets.M;
    expect([sheet.G2.v, sheet.G3.v, sheet.G4.v]).toEqual([10, 2, 2]);
    expect([sheet.E2.v, sheet.E3.v, sheet.E4.v]).toEqual(['PN1*10', 'PN0*2', 'PN2*2']);
    expect([sheet.A2.v, sheet.A3.v, sheet.A4.v]).toEqual([1, 2, 3]);
    expect(sheet.I2).toMatchObject({ f: 'G2/H2', v: 10 / 100 });
    expect(sheet.L2).toMatchObject({ f: 'J2/K2', v: 2 / 50 });
    expect([result.Sheets.Other.G2.v, result.Sheets.Other.G3.v]).toEqual([10, 2]);
    expect(rows.map(row => row.materialCount)).toEqual([2, 10, 2]);
    expect(rows.map(row => row.sequence)).toEqual([1, 2, 3]);
  });

  it('keeps unavailable and zero quantities distinct, and retains models without repairs', () => {
    const workbook = XLSX.utils.book_new();
    appendModelSheets(workbook, [{
      model: 'M',
      rows: [
        { materialCount: 2, materialUsage: 0, serialCount: '缺少SN（1条）', productionQuantity: 10 },
        { materialCount: 0, materialUsage: 10, serialCount: 0, productionQuantity: 10 },
      ],
    }, {
      model: 'empty',
      rows: [{ model: 'empty', repairAction: '无维修故障记录', materialCount: 0, serialCount: 0, productionQuantity: 8 }],
    }]);
    expect(workbook.Sheets.M.I2).toEqual({ t: 's', v: 'n.a.' });
    expect(workbook.Sheets.M.L2).toEqual({ t: 's', v: 'n.a.' });
    expect(workbook.Sheets.M.I3).toMatchObject({ v: 0, f: 'G3/H3' });
    expect(workbook.Sheets.empty.I2).toBeUndefined();
    expect(workbook.Sheets.empty.L2).toMatchObject({ v: 0, f: 'J2/K2' });
  });

  it('keeps model sheet names valid, unique and within the Excel limit', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['source']]), 'M_A');
    appendModelSheets(workbook, [
      { model: 'M/A', rows: [] },
      { model: 'm:a', rows: [] },
      { model: 'Long model '.repeat(8), rows: [] },
      { model: 'Long model '.repeat(8) + '2', rows: [] },
    ]);
    expect(workbook.SheetNames.slice(0, 3)).toEqual(['M_A', 'M_A_2', 'm_a_3']);
    expect(new Set(workbook.SheetNames.map(name => name.toLowerCase())).size).toBe(5);
    expect(workbook.SheetNames.every(name => name.length <= 31)).toBe(true);
  });
});
