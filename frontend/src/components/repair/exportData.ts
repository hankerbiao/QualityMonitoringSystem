import * as XLSX from 'xlsx';
import type { RepairQualityExport } from '../../types';
import { appendSourceSheets } from '../rty/templateExport';

const BUCKETS = ['1', '2', '3', '4', '5', '6', '7', '8', '9+'];

export function buildRepairQualityWorkbook(data: RepairQualityExport): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const headers = ['客户', '基地', '维修 SN', '首修通过率', ...BUCKETS.flatMap(bucket => [
    `${bucket === '9+' ? '9次+' : `${bucket}次`}数量`,
    `${bucket === '9+' ? '9次+' : `${bucket}次`}占比`,
  ])];
  // Overall SN counts are de-duplicated, not a sum of potentially overlapping groups.
  const rows = [...data.summary.groups, { ...data.summary, customer: '总体（SN 去重）', base: '全部' }];
  const sheet = XLSX.utils.aoa_to_sheet([
    headers,
    ...rows.map(row => [
      row.customer, row.base, row.snCount, row.firstPassRate / 100,
      ...BUCKETS.flatMap(bucket => {
        const item = row.distribution.find(value => value.repairCount === bucket);
        return [item?.snCount ?? 0, (item?.percentage ?? 0) / 100];
      }),
    ]),
  ]);
  rows.forEach((_, index) => {
    [3, ...BUCKETS.map((_, bucket) => 5 + bucket * 2)].forEach(column => {
      sheet[XLSX.utils.encode_cell({ r: index + 1, c: column })].z = '0.00%';
    });
  });
  sheet['!cols'] = headers.map((_, index) => ({ wch: index === 0 ? 24 : index === 1 ? 16 : 14 }));
  sheet['!autofilter'] = { ref: `A1:V${data.summary.groups.length + 1}` };
  XLSX.utils.book_append_sheet(workbook, sheet, '维修通过率分析表');
  appendSourceSheets(workbook, data);
  return workbook;
}
