import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { DoaDashboard, DoaFilters, DoaRepairItem } from '../../types/doa';
import { buildDoaWorkbook } from './exportData';

const filters: DoaFilters = { dateFrom: '2026-10-01', dateTo: '2026-10-29', customer: '', model: '', customers: ['客户甲'], timeGranularity: 'day' };
const dashboard: DoaDashboard = {
  filters,
  summary: { shippedCount: 100, repairCount: 2, repairRate: 2, replacementCount: 2, replacementRate: 2, replacementRecordCount: 1, matchedRepairRecords: 1, excludedRepairRecords: 0, unmatchedRepairRecords: 0, missingQuantityRecords: 0, unmatchedPlannedRecords: 1, unmatchedPlannedQuantity: 3, latestDataAt: null },
  trend: [{ period: '2026-10-01', key: '', shippedCount: 100, repairCount: 2, repairRate: 2, replacementCount: 2, replacementRate: 2, repairServerCount: 1 }],
  byCustomer: [{ key: '客户甲', shippedCount: 100, repairCount: 2, repairRate: 2, replacementCount: 2, replacementRate: 2 }],
  byModel: [], unmatchedOrders: [],
};
const repair: DoaRepairItem = { id: 'SCS-1', salesOrder: '001', materialSerial: 'SN1', acceptedAt: '2026-10-02', plannedAt: '2026-10-01', gstrsStatus: 'matched', customer: '客户甲', model: 'M1', shippedDate: '2026-10-01', shippedCount: 100, repairCount: 2, missingQuantity: false, data: { secretRawField: 'not exported' } };

describe('buildDoaWorkbook', () => {
  it('exports all summary dimensions and normalized detail without raw SCS fields', () => {
    const book = buildDoaWorkbook(dashboard, filters, [{ salesOrder: '001', productionOrder: '009', customer: '客户甲', model: 'M1', plannedStartDate: '2026-10-01', quantity: 100 }], { repairs: [repair], replacements: [repair], unmatchedDates: [{ ...repair, id: 'SCS-2', plannedAt: '', gstrsStatus: 'unmatched', repairCount: 3 }] });
    expect(book.SheetNames).toEqual(['质量概览', '周期明细', '客户分析', '机型分析', '到货订单明细', '未匹配销售订单', '报修明细', '换件明细', '未匹配计划日期']);
    expect(XLSX.utils.sheet_to_json(book.Sheets['客户分析'])).toEqual([expect.objectContaining({ 客户: '客户甲', 计划数量: 100, 报修率: 0.02 })]);
    expect(book.Sheets['客户分析'].D2.z).toBe('0.00%');
    expect(XLSX.utils.sheet_to_json(book.Sheets['报修明细'])).toEqual([expect.objectContaining({ 申报编号: 'SCS-1', 问题批次数量: 2 })]);
    expect(JSON.stringify(book)).not.toContain('not exported');
    expect(XLSX.utils.sheet_to_json(book.Sheets['未匹配计划日期'])).toEqual([expect.objectContaining({ 申报编号: 'SCS-2', 问题批次数量: 3 })]);
  });

  it('omits repair details and explains this when the user lacks permission', () => {
    const book = buildDoaWorkbook(dashboard, filters, [], null);
    expect(book.SheetNames).not.toContain('报修明细');
    expect(XLSX.utils.sheet_to_json(book.Sheets['质量概览'])).toContainEqual({ 项目: '报修明细', 内容: '当前账号没有报修明细权限，未导出报修记录。' });
  });
});
