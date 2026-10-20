// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { rtyApi } from '../api/rtyApi';
import StationPassRatePage from './StationPassRatePage';

const context = vi.hoisted(() => ({
  role: 'user',
  stationConfig: { selectedStations: [] as string[], configured: false },
  updateSettings: vi.fn(),
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: context.role } }),
}));
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
    settings: { stationPassRateConfig: context.stationConfig },
    updateSettings: context.updateSettings,
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
    context.role = 'user';
    context.stationConfig = { selectedStations: [], configured: false };
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

  it('uses shared station selection for ordinary users and hides editing', async () => {
    context.stationConfig = { selectedStations: ['OP10'], configured: true };
    vi.mocked(rtyApi.getStationPassRates).mockResolvedValue([
      { dimensionValue: 'M', stationCode: 'OP10', stationName: '装配',
        inputCount: 10, defectCount: 1, passRate: 90, totalInputCount: 20, totalDefectCount: 1 },
      { dimensionValue: 'M', stationCode: 'OP20', stationName: '测试',
        inputCount: 10, defectCount: 0, passRate: 100, totalInputCount: 20, totalDefectCount: 1 },
    ]);
    render(<MemoryRouter><StationPassRatePage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    expect(await screen.findByText('已选 1 / 2 个工站')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '配置工站' })).toBeNull();
    expect(context.updateSettings).not.toHaveBeenCalled();
  });

  it('shows the supplied Chinese station names in table headers', async () => {
    const descriptions = [
      ['OP10', '组装'], ['OP150', '组装'], ['OP170', '组装'],
      ['OP180', 'PQC'], ['OP181', 'L11三总线检测'],
      ['OP190', '保压'], ['OP191', 'L11冷板保压'], ['OP192', 'L11整机柜保压'],
      ['OP195', 'L11注液冲洗'], ['OP200', '初检'], ['OP205', '前测'],
      ['OP210', '压测'], ['OP215', '后测'], ['OP220', '综检'],
      ['OP221', '冲洗'], ['OP222', '排液烘干充氮'], ['OP223', '湿度检测'],
      ['OP228', 'L11排液冲洗'], ['OP229A', 'L11 排液烘干'],
      ['OP229B', 'L11 机柜保压'], ['OP229C', 'L11 注氮'],
      ['OP230', 'CCC安规测试'], ['OP240', 'FQC'], ['OP250', '维修'],
      ['OP300', '外箱贴标'], ['OP310', '附件装箱'], ['OP320', '包装'],
    ] as const;
    vi.mocked(rtyApi.getStationPassRates).mockResolvedValue(descriptions.map(([stationCode]) => ({
      dimensionValue: 'M',
      stationCode,
      stationName: stationCode,
      inputCount: 10,
      defectCount: 1,
      passRate: 90,
      totalInputCount: 10,
      totalDefectCount: 1,
    })));
    render(<MemoryRouter><StationPassRatePage /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    for (const [code, name] of descriptions) {
      expect(await screen.findByRole('columnheader', { name: new RegExp(`${code}.*${name}`) })).toBeTruthy();
    }
  });

  it('allows administrators to persist station selection', async () => {
    context.role = 'admin';
    vi.mocked(rtyApi.getStationPassRates).mockResolvedValue([{
      dimensionValue: 'M', stationCode: 'OP10', stationName: '装配',
      inputCount: 10, defectCount: 1, passRate: 90, totalInputCount: 10, totalDefectCount: 1,
    }]);
    context.updateSettings.mockResolvedValue(undefined);
    render(<MemoryRouter><StationPassRatePage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    fireEvent.click(await screen.findByRole('button', { name: '配置工站' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'OP10' }));
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    await waitFor(() => expect(context.updateSettings).toHaveBeenCalledWith({
      stationPassRateConfig: { selectedStations: [] },
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('passes the selected customer to the station query', async () => {
    render(<MemoryRouter><StationPassRatePage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: '客户 ID（多选）' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'CUST-A' }));
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    await waitFor(() => expect(rtyApi.getStationPassRates).toHaveBeenCalledWith(
      expect.objectContaining({ customers: ['CUST-A'] }),
    ));
  });

  it('uses searchable dropdowns to select multiple models, bases and customers', async () => {
    vi.mocked(rtyApi.getFilterOptions).mockResolvedValue({
      productModels: [{ model: 'Model A', count: 12 }, { model: 'Model B', count: 8 }],
      bases: [{ base: 'Factory A', count: 10 }, { base: 'Factory B', count: 9 }],
      customers: ['CUST-A', 'CUST-B'],
    });
    render(<MemoryRouter><StationPassRatePage /></MemoryRouter>);

    for (const [trigger, dialog, values] of [
      ['客户 ID（多选）', '选择客户 ID', ['CUST-A', 'CUST-B']],
      ['机型（多选）', '选择机型', ['Model A', 'Model B']],
      ['工厂地点（多选）', '选择工厂地点', ['Factory A', 'Factory B']],
    ] as const) {
      const triggerButton = await screen.findByRole('button', { name: trigger });
      fireEvent.mouseDown(triggerButton);
      fireEvent.click(triggerButton);
      const menu = screen.getByRole('dialog', { name: dialog });
      fireEvent.change(within(menu).getByRole('searchbox'), { target: { value: values[0] } });
      fireEvent.click(within(menu).getByRole('checkbox', { name: new RegExp(values[0]) }));
      fireEvent.change(within(menu).getByRole('searchbox'), { target: { value: values[1] } });
      fireEvent.click(within(menu).getByRole('checkbox', { name: new RegExp(values[1]) }));
    }
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    await waitFor(() => expect(rtyApi.getStationPassRates).toHaveBeenCalledWith(
      expect.objectContaining({
        customers: ['CUST-A', 'CUST-B'],
        productModels: ['Model A', 'Model B'],
        bases: ['Factory A', 'Factory B'],
      }),
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
    fireEvent.click(await screen.findByRole('button', { name: '客户 ID（多选）' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'CUST-A' }));
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
      { 机型: 'M', Total: '90.00%', 产量: 20, 故障数: 2, 工站直通率: '90.00%', OP10: '90.00%' },
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
      fireEvent.click(await screen.findByRole('button', { name: '客户 ID（多选）' }));
      await screen.findByRole('checkbox', { name: 'CUST-A' });
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
