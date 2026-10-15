import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { FAULT_COLUMNS, ORDER_COLUMNS } from '../rty/templateExport';
import { buildStationPassWorkbook } from './exportData';

describe('station pass workbook', () => {
  it('preserves the pivot sheet and keeps full source headers even without data', () => {
    const pivot = XLSX.utils.json_to_sheet([{ 机型: 'M', Total: '97.06%', OP10: '100.00%' }]);
    const snapshot = structuredClone(pivot);
    const workbook = buildStationPassWorkbook(pivot, { orders: [], faults: [] });

    expect(workbook.SheetNames).toEqual(['工位直通率透视表', '销售订单', '维修故障明记录']);
    expect(workbook.Sheets['工位直通率透视表']).toEqual(snapshot);
    const orders = XLSX.utils.sheet_to_json(workbook.Sheets['销售订单'], { header: 1 });
    const faults = XLSX.utils.sheet_to_json(workbook.Sheets['维修故障明记录'], { header: 1 });
    expect(orders).toEqual([ORDER_COLUMNS.map(([, label]) => label)]);
    expect(faults).toEqual([FAULT_COLUMNS.map(([, label]) => label)]);
    expect(orders[0]).toHaveLength(18);
    expect(faults[0]).toHaveLength(34);
  });

  it('round trips raw values, blank fields, leading zeros and repeated SN repairs', () => {
    const workbook = buildStationPassWorkbook(XLSX.utils.aoa_to_sheet([['机型']]), {
      orders: [{ VBELN: '0000123', AUFNR: '000000000001', IF_L6: 'X', WMENG: 0 }],
      faults: [
        { PCODE: '00001', U_FIX: '甲', ZWXDT: null, ZUSER: '不替代维修人员' },
        { PCODE: '00001', U_FIX: '乙', ZWXDT: '2027-01-01', ERROR_MSG: '=literal' },
      ],
    });
    const result = XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), {
      type: 'buffer',
    });
    const orders = result.Sheets['销售订单'];
    const faults = result.Sheets['维修故障明记录'];
    expect(orders.A2).toMatchObject({ t: 's', v: '0000123' });
    expect(orders.C2).toMatchObject({ t: 's', v: '000000000001' });
    expect(orders.F2.v).toBe('X');
    expect(orders.J2).toMatchObject({ t: 'n', v: 0 });
    expect(orders.B2).toBeUndefined();
    expect(faults.E2).toMatchObject({ t: 's', v: '00001' });
    expect(faults.E3).toMatchObject({ t: 's', v: '00001' });
    expect(faults.K2.v).toBe('甲');
    expect(faults.L2).toBeUndefined();
    expect(faults.L3.v).toBe('2027-01-01');
    expect(faults.AB3).toMatchObject({ t: 's', v: '=literal' });
    expect(faults.AB3.f).toBeUndefined();
  });
});
