import * as XLSX from 'xlsx';
import type { StationPassExport } from '../../types/rty';
import { appendSourceSheets } from '../rty/templateExport';

export function buildStationPassWorkbook(
  pivotSheet: XLSX.WorkSheet,
  data: StationPassExport,
): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, pivotSheet, '工位直通率透视表');
  appendSourceSheets(workbook, data);
  return workbook;
}
