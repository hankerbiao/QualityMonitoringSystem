import * as XLSX from 'xlsx';
import type { StationPassExport } from '../../types/rty';
import { FAULT_COLUMNS, ORDER_COLUMNS } from '../rty/templateExport';

export function buildStationPassWorkbook(
  pivotSheet: XLSX.WorkSheet,
  data: StationPassExport,
): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, pivotSheet, '工位直通率透视表');
  const sources = [
    ['销售订单', ORDER_COLUMNS, data.orders],
    ['维修故障明记录', FAULT_COLUMNS, data.faults],
  ] as const;
  for (const [name, columns, rows] of sources) {
    const sheet = XLSX.utils.aoa_to_sheet([
      columns.map(([, label]) => label),
      ...rows.map((row) => columns.map(([key]) => row[key] ?? null)),
    ]);
    sheet['!cols'] = columns.map(([, label]) => ({
      wch: Math.min(48, Math.max(16, label.length * 1.4)),
    }));
    sheet['!autofilter'] = { ref: sheet['!ref']! };
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  }
  return workbook;
}
