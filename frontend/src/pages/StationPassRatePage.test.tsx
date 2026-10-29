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

  it('defaults to all order types and sends multiple selected types to queries and details', async () => {
    vi.mocked(rtyApi.getFilterOptions).mockResolvedValue({ productModels: [], bases: [], customers: [], orderTypes: ['PP01', 'G001'] });
    vi.mocked(rtyApi.getStationPassRates).mockResolvedValue([{
      dimensionValue: 'M', stationCode: 'OP10', stationName: '装配', inputCount: 2,
      defectCount: 0, passRate: 100, totalInputCount: 2, totalDefectCount: 0,
    }]);
    render(<MemoryRouter><StationPassRatePage /></MemoryRouter>);
    expect(screen.getByRole('button', { name: '订单类型（多选）' }).textContent).toContain('全部订单类型');
    expect(screen.queryByLabelText('服务器 SN')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    await waitFor(() => expect(rtyApi.getStationPassRates).toHaveBeenCalledWith(expect.not.objectContaining({ orderTypes: expect.anything() })));
    fireEvent.click(screen.getByRole('button', { name: '订单类型（多选）' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'PP01' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'G001' }));
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    await waitFor(() => expect(rtyApi.getStationPassRates).toHaveBeenLastCalledWith(expect.objectContaining({ orderTypes: ['PP01', 'G001'] })));
    expect(vi.mocked(rtyApi.getStationPassRates).mock.lastCall?.[0]).not.toHaveProperty('serialNumber');
    fireEvent.click(await screen.findByRole('button', { name: /100.00%.*0\/2/ }));
    await waitFor(() => expect(rtyApi.getStationPassDetails).toHaveBeenCalledWith('OP10', expect.objectContaining({ orderTypes: ['PP01', 'G001'] }), 'input'));
  });

  it('applies a date range to the next manual query and invalidates previous results', async () => {
    context.stationConfig = { selectedStations: ['OP10'], configured: true };
    vi.mocked(rtyApi.getStationPassRates).mockResolvedValue([{
      dimensionValue: 'M', stationCode: 'OP10', stationName: '装配',
      inputCount: 10, defectCount: 1, passRate: 90, totalInputCount: 10, totalDefectCount: 1,
    }]);
    render(<MemoryRouter><StationPassRatePage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    await screen.findByText('已选 1 / 45 个工站');
    fireEvent.click(screen.getByRole('button', { name: '计划开始日期（GSTRS）' }));
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-01-31' } });
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(rtyApi.getStationPassRates).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('已选 1 / 45 个工站')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    await waitFor(() => expect(rtyApi.getStationPassRates).toHaveBeenLastCalledWith(
      expect.objectContaining({ dateFrom: '2026-01-01', dateTo: '2026-01-31' }),
    ));
  });

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
    expect(await screen.findByText('已选 1 / 45 个工站')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '配置工站' })).toBeNull();
    expect(context.updateSettings).not.toHaveBeenCalled();
  });

  it('renders only the static station headers, regardless of API station codes', async () => {
    const descriptions = [
      ['OP10', '组装'], ['OP20', '组装'], ['OP30', '组装'], ['OP40', '组装'], ['OP50', '组装'],
      ['OP60', '组装'], ['OP70', '组装'], ['OP80', '组装'], ['OP81', '组装'], ['OP82', '组装'], ['OP83', '组装'], ['OP90', '组装'],
      ['OP150', 'PQC'], ['OP160', '组装'], ['OP170', '组装'],
      ['OP180', 'PQC'], ['OP181', 'L11三总线检测'],
      ['OP190', '保压'], ['OP191', 'L11冷板保压'], ['OP192', 'L11整机柜保压'],
      ['OP195', 'L11注液冲洗'], ['OP199', '保压'], ['OP200', '初检'], ['OP205', '前测'],
      ['OP210', '压测'], ['OP215', '后测'], ['OP220', '综检'],
      ['OP221', '冲洗'], ['OP222', '排液烘干充氮'], ['OP223', '湿度检测'],
      ['OP224', 'L11节点前测'], ['OP225', 'L11节点压测'], ['OP226', 'L11节点后测'], ['OP227', 'L11节点排液烘干充氮'],
      ['OP228', 'L11排液冲洗'], ['OP229A', 'L11 排液烘干'],
      ['OP229B', 'L11 机柜保压'], ['OP229C', 'L11 注氮'],
      ['OP230', 'CCC安规测试'], ['OP240', 'FQC'], ['OP250', '维修'], ['OP251', '维修'],
      ['OP300', '外箱贴标'], ['OP310', '附件装箱'], ['OP320', '包装'],
    ] as const;
    context.stationConfig = { selectedStations: descriptions.map(([stationCode]) => stationCode), configured: true };
    vi.mocked(rtyApi.getStationPassRates).mockResolvedValue([...descriptions.map(([stationCode]) => ({
      dimensionValue: 'M',
      stationCode,
      stationName: stationCode,
      inputCount: 10,
      defectCount: 1,
      passRate: 90,
      totalInputCount: 10,
      totalDefectCount: 1,
    })), {
      dimensionValue: 'M',
      stationCode: 'OP999',
      stationName: '接口动态工站',
      inputCount: 10,
      defectCount: 1,
      passRate: 90,
      totalInputCount: 10,
      totalDefectCount: 1,
    }]);
    render(<MemoryRouter><StationPassRatePage /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    const stationTable = (await screen.findByRole('columnheader', { name: /OP10/ })).closest('table');
    expect(stationTable).not.toBeNull();
    const headers = within(stationTable as HTMLTableElement).getAllByRole('columnheader');
    const stationHeaders = headers.slice(3);
    for (const [code, name] of descriptions) {
      const stationHeader = stationHeaders.find((header) => header.textContent?.includes(code));
      expect(stationHeader).toBeTruthy();
      expect(stationHeader?.textContent).not.toContain(name);
      if (name) {
        const help = within(stationHeader as HTMLElement).getByRole('button', { name: `查看工位 ${code} 说明` });
        fireEvent.focus(help);
        expect(screen.getByRole('tooltip').textContent).toBe(name);
        fireEvent.blur(help);
      } else {
        expect(within(stationHeader as HTMLElement).queryByRole('button')).toBeNull();
      }
    }
    expect(stationHeaders.some((header) => header.textContent?.includes('OP999'))).toBe(false);
    expect(descriptions).toHaveLength(45);
    expect(stationHeaders.filter((header) => /^OP/.test(header.textContent?.trim() ?? '')).length).toBe(descriptions.length);
  });

  it('allows administrators to persist station selection', async () => {
    context.role = 'admin';
    vi.mocked(rtyApi.getStationPassRates).mockResolvedValue([
      { dimensionValue: 'M', stationCode: 'OP10', stationName: '装配',
        inputCount: 10, defectCount: 1, passRate: 90, totalInputCount: 10, totalDefectCount: 1 },
      { dimensionValue: 'M', stationCode: 'OP20', stationName: '测试',
        inputCount: 10, defectCount: 0, passRate: 100, totalInputCount: 10, totalDefectCount: 1 },
    ]);
    context.updateSettings.mockResolvedValue(undefined);
    render(<MemoryRouter><StationPassRatePage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    fireEvent.click(await screen.findByRole('button', { name: '配置工站' }));
    fireEvent.click(screen.getByRole('button', { name: '清空' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'OP10' }));
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    await waitFor(() => expect(context.updateSettings).toHaveBeenCalledWith({
      stationPassRateConfig: { selectedStations: ['OP10'] },
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('columnheader', { name: /OP10/ })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: /OP20/ })).toBeNull();
    expect(screen.getAllByText('90.00%').length).toBeGreaterThan(0);
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
      totalInputCount: 10, totalDefectCount: 2,
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
    const exportButton = screen.getByRole('button', { name: '导出透视表、销售订单及维修故障明细记录' });
    expect((exportButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(await screen.findByRole('button', { name: '客户 ID（多选）' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'CUST-A' }));
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    await waitFor(() => expect((exportButton as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText('80.00%')).toBeTruthy();
    expect(screen.getByText('2/10')).toBeTruthy();
    fireEvent.click(exportButton);

    await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalledTimes(1));
    expect(rtyApi.getStationPassExport).toHaveBeenCalledWith(
      vi.mocked(rtyApi.getStationPassRates).mock.calls[0][0],
    );
    expect(rtyApi.getStationPassDetails).not.toHaveBeenCalled();
    const workbook = vi.mocked(XLSX.writeFile).mock.calls[0][0];
    expect(workbook.SheetNames).toEqual(['工位直通率透视表', '销售订单', '维修故障明细记录', 'M']);
    expect(workbook.Sheets.M.E2.v).toBe('PN*2');
    expect(workbook.Sheets.M.L2.f).toBe('J2/K2');
    const pivotRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['工位直通率透视表']);
    expect(pivotRows).toHaveLength(1);
    expect(pivotRows[0]).toMatchObject({
      机型: 'M', Total: '80.00%', 订单数量: 10, 故障数: 2, 工站直通率: '90.00%', OP10: '90.00%',
    });
    expect(Object.keys(pivotRows[0]).filter((key) => key.startsWith('OP'))).toHaveLength(45);
    expect(XLSX.utils.sheet_to_json(workbook.Sheets['维修故障明细记录'])).toHaveLength(2);
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
      const button = screen.getByRole('button', { name: '导出透视表、销售订单及维修故障明细记录' });
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

  it('exports repair SN with the shared raw fault detail sheet format', async () => {
    vi.mocked(rtyApi.getStationPassRates).mockResolvedValue([{
      dimensionValue: 'M', stationCode: 'OP10', stationName: '装配',
      inputCount: 10, defectCount: 1, passRate: 90,
      totalInputCount: 10, totalDefectCount: 1,
    }]);
    vi.mocked(rtyApi.getStationPassDetails).mockResolvedValue([{
      id: 'repair-1',
      sn: '00001',
      stationCode: 'OP10',
      stationName: '装配',
      passDate: '20261022',
      status: 'defect',
      repairTime: '',
      defectCode: 'E01',
      description: '故障描述',
      repairPerson: '维修人',
      matchedModel: 'M',
      raw: {
        FACTORY: '基地A',
        PCODE: '00001',
        VBELN: 'SO-1',
        AUFNR: 'PO-1',
        ZNGGZ: 'OP10',
        ZNGWD3: '维度3',
        ZWXWD3: '处理措施',
        ZNGWD2: '维度2',
        U_FIX: '维修人',
        ZWXDT: '20261022123000',
        AUART: 'C001',
      },
    }]);
    render(<MemoryRouter><StationPassRatePage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    fireEvent.click(await screen.findByRole('button', { name: /90\.00%/ }));
    fireEvent.click(await screen.findByRole('button', { name: '维修 SN' }));
    await waitFor(() => expect(rtyApi.getStationPassDetails).toHaveBeenCalledTimes(2));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getAllByRole('columnheader').map(header => header.textContent)).toEqual([
      '计入机型', '维修记录SN', '销售订单', '维修记录订单', '故障现象',
      '维修措施', '故障工站', '维修人员', '维修时间',
    ]);
    const cells = within(dialog.getByRole('row', { name: /00001/ })).getAllByRole('cell');
    expect(cells.map(cell => cell.textContent)).toEqual([
      'M', '00001', 'SO-1', 'PO-1', '维度3', '处理措施', 'OP10', '维修人', '20261022123000',
    ]);

    fireEvent.click(screen.getByRole('button', { name: '导出维修 SN' }));
    await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalledTimes(1));

    const workbook = vi.mocked(XLSX.writeFile).mock.calls[0][0];
    expect(workbook.SheetNames).toEqual(['维修故障明细记录']);
    const sheet = workbook.Sheets['维修故障明细记录'];
    expect(sheet.J1.v).toBe('不良现象维度2');
    expect(sheet.J2.v).toBe('维度2');
    expect(sheet.E2.v).toBe('00001');
    expect(sheet.AI1.v).toBe('订单类型');
    expect(sheet['!autofilter']).toEqual({ ref: 'A1:AI2' });
  });

  it('shows an error when station repair details cannot be loaded', async () => {
    vi.mocked(rtyApi.getStationPassRates).mockResolvedValue([{
      dimensionValue: 'M', stationCode: 'OP10', stationName: '装配',
      inputCount: 10, defectCount: 1, passRate: 90,
      totalInputCount: 10, totalDefectCount: 1,
    }]);
    vi.mocked(rtyApi.getStationPassDetails)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('维修明细读取失败'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<MemoryRouter><StationPassRatePage /></MemoryRouter>);
      fireEvent.click(screen.getByRole('button', { name: '查询' }));
      fireEvent.click(await screen.findByRole('button', { name: /90\.00%/ }));
      fireEvent.click(await screen.findByRole('button', { name: '维修 SN' }));
      expect(await screen.findByRole('alert')).toHaveProperty('textContent', '维修明细读取失败');
    } finally {
      log.mockRestore();
    }
  });
});
