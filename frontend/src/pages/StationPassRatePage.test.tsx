// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { rtyApi } from '../api/rtyApi';
import StationPassRatePage from './StationPassRatePage';

vi.mock('../api/rtyApi', () => ({
  rtyApi: {
    getFilterOptions: vi.fn(),
    getStationPassRates: vi.fn(),
    getStationPassDetails: vi.fn(),
    getStationPassExport: vi.fn(),
  },
}));
vi.mock('xlsx', async (importOriginal) => ({
  ...await importOriginal<typeof import('xlsx')>(),
  writeFile: vi.fn(),
}));
vi.mock('../context/SettingsContext', () => ({
  useSettings: () => ({
    settings: { stationPassRateConfig: { selectedStations: [], configured: false } },
    updateSettings: vi.fn(),
  }),
}));
vi.mock('../components/shared/DashboardSwitcher', () => ({ DashboardSwitcher: () => null }));
vi.mock('../components/shared/MonthQuickPicker', () => ({ MonthQuickPicker: () => null }));
vi.mock('../components/station/StationPassWorkspace', () => ({
  StationPassFindings: () => null,
  StationQueryLaunch: () => null,
}));

describe('StationPassRatePage customer filter', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(rtyApi.getFilterOptions).mockResolvedValue({
      productModels: [],
      bases: [],
      customers: ['CUST-A'],
    });
    vi.mocked(rtyApi.getStationPassRates).mockResolvedValue([]);
    vi.mocked(rtyApi.getStationPassDetails).mockResolvedValue([]);
    vi.mocked(rtyApi.getStationPassExport).mockResolvedValue({ orders: [], faults: [] });
  });
  afterEach(cleanup);

  it('passes the selected customer to the station query', async () => {
    render(<MemoryRouter><StationPassRatePage /></MemoryRouter>);

    await screen.findByRole('option', { name: 'CUST-A' });
    fireEvent.change(screen.getByLabelText('客户 ID'), { target: { value: 'CUST-A' } });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    await waitFor(() => expect(rtyApi.getStationPassRates).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'CUST-A' }),
    ));
  });

  it('passes the overseas checkbox to the station query', async () => {
    render(<MemoryRouter><StationPassRatePage /></MemoryRouter>);

    fireEvent.click(screen.getByRole('checkbox', { name: '海外' }));
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    await waitFor(() => expect(rtyApi.getStationPassRates).toHaveBeenCalledWith(
      expect.objectContaining({ overseas: true }),
    ));
  });

  it('exports three sheets with the applied query and preserves pivot values', async () => {
    vi.mocked(rtyApi.getStationPassRates).mockResolvedValue([{
      dimensionValue: 'M', stationCode: 'OP10', stationName: '装配',
      inputCount: 10, defectCount: 1, passRate: 90,
      totalInputCount: 20, totalDefectCount: 2,
    }]);
    vi.mocked(rtyApi.getStationPassExport).mockResolvedValue({
      orders: [{ VBELN: '00001', WMENG: 20 }],
      faults: [{ PCODE: 'SN1', ZNGGZ: 'OP10' }, { PCODE: 'SN1', ZNGGZ: 'OP10' }],
      modelSheets: [{
        model: 'M',
        rows: [{
          model: 'M', material: 'PN*2', materialCount: 2,
          materialUsage: 20, serialCount: 1, productionQuantity: 20,
        }],
      }],
    });
    render(<MemoryRouter><StationPassRatePage /></MemoryRouter>);
    const exportButton = screen.getByRole('button', { name: '导出透视表、销售订单及维修故障明记录' });
    expect((exportButton as HTMLButtonElement).disabled).toBe(true);
    await screen.findByRole('option', { name: 'CUST-A' });
    fireEvent.change(screen.getByLabelText('客户 ID'), { target: { value: 'CUST-A' } });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    await waitFor(() => expect((exportButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(exportButton);

    await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalledTimes(1));
    expect(rtyApi.getStationPassExport).toHaveBeenCalledWith(
      vi.mocked(rtyApi.getStationPassRates).mock.calls[0][0],
    );
    expect(rtyApi.getStationPassDetails).not.toHaveBeenCalled();
    const workbook = vi.mocked(XLSX.writeFile).mock.calls[0][0];
    expect(workbook.SheetNames).toEqual(['工位直通率透视表', '销售订单', '维修故障明记录', 'M']);
    expect(workbook.Sheets.M.E2.v).toBe('PN*2');
    expect(workbook.Sheets.M.L2.f).toBe('J2/K2');
    expect(XLSX.utils.sheet_to_json(workbook.Sheets['工位直通率透视表'])).toEqual([
      { 机型: 'M', Total: '90.00%', 工站直通率: '90.00%', OP10: '90.00%' },
    ]);
    expect(XLSX.utils.sheet_to_json(workbook.Sheets['维修故障明记录'])).toHaveLength(2);
  });

  it('shows source failures, avoids partial downloads and allows retry', async () => {
    vi.mocked(rtyApi.getStationPassRates).mockResolvedValue([{
      dimensionValue: 'M', stationCode: 'OP10', stationName: '装配',
      inputCount: 10, defectCount: 0, passRate: 100,
      totalInputCount: 10, totalDefectCount: 0,
    }]);
    vi.mocked(rtyApi.getStationPassExport).mockRejectedValueOnce(new Error('原始数据查询失败'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<MemoryRouter><StationPassRatePage /></MemoryRouter>);
      await screen.findByRole('option', { name: 'CUST-A' });
      fireEvent.click(screen.getByRole('button', { name: '查询' }));
      const button = screen.getByRole('button', { name: '导出透视表、销售订单及维修故障明记录' });
      await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(button);
      expect(await screen.findByRole('alert')).toHaveProperty('textContent', '原始数据查询失败');
      expect(XLSX.writeFile).not.toHaveBeenCalled();
      expect((button as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(button);
      await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalledTimes(1));
    } finally {
      log.mockRestore();
    }
  });
});
