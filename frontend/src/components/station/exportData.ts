import * as XLSX from 'xlsx';
import type { StationPassExport } from '../../types/rty';
import { appendSourceSheets, buildFaultDetailSheet, FAULT_COLUMNS } from '../rty/templateExport';

const repairDateColumn = FAULT_COLUMNS.findIndex(([key]) => key === 'ZWXDT');

export function buildStationRepairSheet(rows: readonly Record<string, unknown>[]): XLSX.WorkSheet {
  const sheet = buildFaultDetailSheet(rows);
  rows.forEach(({ ZWXDT }, index) => {
    if (typeof ZWXDT !== 'string' && typeof ZWXDT !== 'number') return;
    const value = String(ZWXDT).trim();
    const parts = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2}))?$/.exec(value)
      ?? /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
    if (!parts) return;

    const [, year, month, day, hour = '00', minute = '00', second = '00'] = parts;
    const timestamp = `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
    const time = Date.parse(timestamp);
    if (year < '1900' || !Number.isFinite(time) || new Date(time).toISOString() !== timestamp) return;

    // Excel uses a 1900 date system with an extra leap day after February 28.
    const serial = time / 86_400_000 + (timestamp < '1900-03-01' ? 25568 : 25569);
    const cell = sheet[XLSX.utils.encode_cell({ c: repairDateColumn, r: index + 1 })];
    cell.t = 'n';
    cell.v = serial;
    cell.z = 'yyyymmdd';
  });
  return sheet;
}

export function buildStationPassWorkbook(
  pivotSheet: XLSX.WorkSheet,
  data: StationPassExport,
): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, pivotSheet, '工位直通率透视表');
  appendSourceSheets(workbook, data, buildStationRepairSheet(data.faults));
  return workbook;
}
