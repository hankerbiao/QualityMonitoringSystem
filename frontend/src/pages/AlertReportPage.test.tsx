// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { alertReportApi } from '../api/alertReport';
import { buildFaultDetailSheet, FAULT_COLUMNS } from '../components/rty/templateExport';
import type { AlertReportData } from '../types/alertReport';
import AlertReportPage from './AlertReportPage';

vi.mock('../api/alertReport', () => ({
  alertReportApi: { getReport: vi.fn(), getFaultExport: vi.fn() },
}));
vi.mock('xlsx', async importOriginal => ({
  ...await importOriginal<typeof XLSX>(), writeFile: vi.fn(),
}));

const report: AlertReportData = {
  context: { productModel: '6615 X23', base: '1000' },
  summary: {
    productModel: '6615 X23', base: '1000', customer: '',
    inputCount: 10, defectCount: 1, rtyRate: 90, targetRate: 95, reached: false,
  },
  defects: [{
    id: 'display', sn: 'DISPLAY-SN', defectCode: '', description: '', count: 1,
    sale_no: '', mfg_order: '', product_family: '', fault_2nd_appear: '',
    fault_3rd_appear: '', repairTime: '', repairPerson: '', repair_effectiveness: '', customer: '',
  }],
  generatedAt: '2026-10-27 10:30',
  expiresAt: '2026-11-03 10:30',
};
const rows = Array.from({ length: 1001 }, (_, index) => ({
  PCODE: `00000${index}`, AUFNR: '000000000001', T_FIND: '2026-10-20 10:00:00',
  ZNGWD3: '完整不良现象', ZNGWD2: '二级现象', ZWXWD3: '更换部件',
  U_FIX: '维修员', MATNR: '0000123', ERROR_MSG: '=literal',
}));

function renderReport() {
  render(
    <MemoryRouter initialEntries={['/alert-report/signed.token']}>
      <Routes><Route path="/alert-report/:token" element={<AlertReportPage />} /></Routes>
    </MemoryRouter>,
  );
}

describe('alert report fault detail export', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(alertReportApi.getReport).mockResolvedValue(report);
    vi.mocked(alertReportApi.getFaultExport).mockResolvedValue(rows);
  });
  afterEach(cleanup);

  it('exports all raw records using the exact RTY/station sheet format', async () => {
    renderReport();
    fireEvent.click(await screen.findByRole('button', { name: '导出故障明细' }));
    await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalledOnce());
    expect(alertReportApi.getFaultExport).toHaveBeenCalledWith('signed.token');
    const [book, filename] = vi.mocked(XLSX.writeFile).mock.calls[0];
    expect(book.SheetNames).toEqual(['维修故障明细记录']);
    const sheet = book.Sheets['维修故障明细记录'];
    expect(sheet).toEqual(buildFaultDetailSheet(rows));
    const result = XLSX.read(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
    const exported = result.Sheets['维修故障明细记录'];
    expect(XLSX.utils.sheet_to_json(exported, { header: 1 })[0])
      .toEqual(FAULT_COLUMNS.map(([, label]) => label));
    expect(exported['!ref']).toBe('A1:AI1002');
    expect(exported.E2).toMatchObject({ t: 's', v: '000000' });
    expect(exported.I2.v).toBe('完整不良现象');
    expect(exported.J2.v).toBe('二级现象');
    expect(exported.M2.v).toBe('更换部件');
    expect(exported.T2).toMatchObject({ t: 's', v: '0000123' });
    expect(exported.AB2).toMatchObject({ t: 's', v: '=literal' });
    expect(exported.AB2.f).toBeUndefined();
    expect(filename).toBe('故障明细_6615 X23_2026-10-27 10_30.xlsx');
  });

  it('prevents duplicate downloads and supports retry after an export failure', async () => {
    let rejectExport!: (error: Error) => void;
    vi.mocked(alertReportApi.getFaultExport).mockImplementationOnce(
      () => new Promise((_, reject) => { rejectExport = reject; }),
    );
    renderReport();
    fireEvent.click(await screen.findByRole('button', { name: '导出故障明细' }));
    const button = screen.getByRole('button', { name: '导出中...' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(alertReportApi.getFaultExport).toHaveBeenCalledOnce();
    rejectExport(new Error('数据源不可用'));
    expect((await screen.findByRole('alert')).textContent).toContain('数据源不可用');
    expect(XLSX.writeFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '导出故障明细' }));
    await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalledOnce());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('disables detail export for empty reports', async () => {
    vi.mocked(alertReportApi.getReport).mockResolvedValue({
      ...report, defects: [], summary: { ...report.summary, defectCount: 0 },
    });
    renderReport();
    const button = await screen.findByRole('button', { name: '导出故障明细' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(alertReportApi.getFaultExport).not.toHaveBeenCalled();
  });
});
