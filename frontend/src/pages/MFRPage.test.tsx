// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { mfrApi } from '../api/mfrApi';
import type { MFRDashboard, MFRExport, MFRFilters } from '../types/mfr';
import { formatLocalDate } from '../utils/dateRange';
import MFRPage from './MFRPage';

const xlsx = vi.hoisted(() => ({
  book_new: vi.fn(() => ({})),
  json_to_sheet: vi.fn((rows: unknown) => rows),
  aoa_to_sheet: vi.fn((rows: unknown) => rows),
  book_append_sheet: vi.fn(),
  writeFile: vi.fn(),
}));
vi.mock('xlsx', () => ({ utils: xlsx, writeFile: xlsx.writeFile }));
vi.mock('../api/mfrApi', () => ({ mfrApi: { getDashboard: vi.fn(), getExport: vi.fn() } }));
vi.mock('../components/shared/DashboardSwitcher', () => ({ DashboardSwitcher: () => null }));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => children,
  ComposedChart: ({ children, data }: { children: ReactNode; data: Array<{ period: string }> }) =>
    <div data-testid="trend-chart" data-periods={data.map(item => item.period).join(',')}>{children}</div>,
  Bar: ({ dataKey, onClick }: { dataKey: string; onClick?: (item: object, index: number) => void }) =>
    <span data-testid={dataKey}>{onClick && <button onClick={() => onClick({}, 0)}>测试趋势柱</button>}</span>,
  CartesianGrid: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null,
}));

const fixture = (filters: MFRFilters): MFRDashboard => ({
  filters,
  summary: { faultCount: 12, fleetCount: 400, mfrRate: 3, sourceDeviceCount: 402, selectedDeviceCount: 400, deviceIssues: { identityUnverified: 2, faultDateUnresolved: 1 }, unmatchedChangeCount: 1 },
  trend: [{ period: '2026-01', key: '2026-01', faultCount: 12, fleetCount: 400, mfrRate: 3 }],
  dailyTrend: filters.dateFrom.slice(0, 7) === filters.dateTo.slice(0, 7)
    ? [{ period: filters.dateFrom, faultCount: 4 }, { period: filters.dateTo, faultCount: 8 }]
    : [],
  byModel: [
    { key: 'Model A', faultCount: 10, fleetCount: 200, mfrRate: 5 },
    { key: 'Model B', faultCount: 2, fleetCount: 200, mfrRate: 1 },
  ],
});

describe('MFR dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value(this: HTMLDialogElement) { this.open = true; },
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = false;
        this.dispatchEvent(new Event('close'));
      },
    });
    vi.mocked(mfrApi.getDashboard).mockImplementation(async filters => fixture(filters));
    vi.mocked(mfrApi.getExport).mockImplementation(async filters => ({ ...fixture(filters), faultDetails: [{
      model: 'Model A', plannedDate: '2026-01-10', shipmentDate: '2026-01-10', productionOrder: '123', deviceSn: 'SN1',
      doaCode: 'KX202601100001', faultDate: '2026-01-10', serviceOrder: 'S1', changeId: 'C1', changeType: '换上', occurredAt: '2026-12-01',
      partNumber: 'PN1', partSn: 'PS1', partName: '部件', customer: '客户',
    }],
    deviceIssueDetails: [{
      reason: 'identityUnverified', deviceKey: 'material:MS1', deviceSn: 'MS1', identityBasis: 'material_sn',
      doaCodes: ['D1'], salesOrders: ['XNC1'], serviceOrders: ['S1'], declarationStates: ['判定 是'],
    }],
    changeIssueDetails: [{
      reason: 'faultDateUnresolved', deviceKey: 'product:SN1', deviceSn: 'SN1', changeDeviceSn: 'SN2',
      doaCodes: ['D2'], serviceOrder: 'S2', changeId: 'C2', changeType: '换上', occurredAt: '2026-12-01',
      partNumber: 'PN2', partSn: 'PS2',
    }],
    }));
  });
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  });

  it('shows the dashboard loading state until the request completes', async () => {
    let resolve!: (value: MFRDashboard) => void;
    vi.mocked(mfrApi.getDashboard).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    render(<MemoryRouter><MFRPage /></MemoryRouter>);
    expect(screen.getByRole('status', { name: '正在加载 MFR 看板数据' })).toBeTruthy();
    expect(screen.queryByText('质量概览')).toBeNull();
    resolve(fixture({ dateFrom: '2026-01-01', dateTo: '2026-10-27' }));
    expect(await screen.findByText('质量概览')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('loads the current month and explains the device denominator and unresolved evidence', async () => {
    render(<MemoryRouter><MFRPage /></MemoryRouter>);
    const today = new Date();
    await screen.findAllByText('期末在保台数');
    expect(mfrApi.getDashboard).toHaveBeenCalledWith({
      dateFrom: formatLocalDate(new Date(today.getFullYear(), today.getMonth(), 1)), dateTo: formatLocalDate(today),
    });
    const fleetMetricHelp = screen.getByRole('button', { name: '查看期末在保台数说明' });
    fireEvent.focus(fleetMetricHelp);
    expect(screen.getByRole('tooltip').textContent).toContain('LFIMG 出货数量');
    fireEvent.blur(fleetMetricHelp);
    const coverageHelp = screen.getByRole('button', { name: '查看未归属设备说明' });
    fireEvent.focus(coverageHelp);
    expect(screen.getByRole('tooltip').textContent).toContain('不受当前日期筛选');
    fireEvent.blur(coverageHelp);
    const trendHelp = screen.getByRole('button', { name: '查看趋势统计方式' });
    expect(screen.queryByText('按申报单号中的故障日期展示，每台整机计入当月首次有效故障所在日。')).toBeNull();
    fireEvent.focus(trendHelp);
    expect(screen.getByRole('tooltip').textContent).toBe('按申报单号中的故障日期展示，每台整机计入当月首次有效故障所在日。');
    fireEvent.blur(trendHelp);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.getByTestId('trend-chart').getAttribute('data-periods')).toContain(formatLocalDate(today));
    expect(screen.queryByTestId('shipmentCount')).toBeNull();
  });

  it('always keeps the filter controls visible and shows pending selections', async () => {
    render(<MemoryRouter><MFRPage /></MemoryRouter>);
    await screen.findAllByText('期末在保台数');
    expect(screen.queryByLabelText('机型')).toBeNull();
    expect(screen.queryByRole('button', { name: '客户ID' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '故障日期' }));
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2025-12-01' } });
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(screen.getByText(/待应用/)).toBeTruthy();
    expect(mfrApi.getDashboard).toHaveBeenCalledTimes(1);
  });

  it('switches to monthly fault counts for a multi-month range', async () => {
    render(<MemoryRouter><MFRPage /></MemoryRouter>);
    await screen.findByRole('heading', { name: '现网故障趋势' });
    fireEvent.click(screen.getByRole('button', { name: '故障日期' }));
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-03-31' } });
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    await screen.findByTestId('faultCount');
    const trendHelp = screen.getByRole('button', { name: '查看趋势统计方式' });
    expect(screen.queryByText(/故障按申报单号中的日期归月/)).toBeNull();
    fireEvent.focus(trendHelp);
    expect(screen.getByRole('tooltip').textContent).toContain('故障按申报单号中的日期归月');
    expect(screen.getByTestId('trend-chart').getAttribute('data-periods')).toBe('2026-01');
    expect(screen.queryByRole('button', { name: '按日看故障' })).toBeNull();
  });

  it('exports the applied overall, monthly and fault data', async () => {
    render(<MemoryRouter><MFRPage /></MemoryRouter>);
    await screen.findByRole('button', { name: '导出统计数据' });
    fireEvent.click(within(screen.getByRole('button', { name: '导出统计数据' })).getByText('导出统计数据'));
    await waitFor(() => expect(xlsx.writeFile).toHaveBeenCalled());
    expect(mfrApi.getExport).toHaveBeenCalledWith(expect.objectContaining({ dateFrom: expect.any(String), dateTo: expect.any(String) }));
    expect(xlsx.book_append_sheet.mock.calls.map(call => call[2])).toEqual(['质量概览', '月度明细', '故障明细']);
    expect(xlsx.aoa_to_sheet).toHaveBeenCalledWith(expect.arrayContaining([
      ['Model A', '2026-01-10', 'KX202601100001', '2026-01-10', '123', 'SN1', 'S1', 'C1', '换上', '2026-12-01', 'PN1', 'PS1', '部件', '客户'],
    ]));
    expect(xlsx.json_to_sheet).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ 统计月份: '2026-01', 故障整机: 12, 在保台数: 400 })]));
    expect(xlsx.writeFile).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/^MFR统计_.*\.xlsx$/));
  });

  it('shows and exports only monthly fault counts', async () => {
    vi.mocked(mfrApi.getDashboard).mockImplementationOnce(async filters => ({
      ...fixture(filters),
      dailyTrend: [],
      trend: [
        { period: '2026-01', key: '2026-01', faultCount: 2, fleetCount: 400, mfrRate: 0.5 },
        { period: '2026-02', key: '2026-02', faultCount: 3, fleetCount: 650, mfrRate: 0.46 },
      ],
    }));
    render(<MemoryRouter><MFRPage /></MemoryRouter>);
    const chart = await screen.findByRole('region', { name: '现网故障趋势' });
    expect(within(chart).queryByTestId('shipmentCount')).toBeNull();
    expect(within(chart).getByTestId('faultCount')).toBeTruthy();
    fireEvent.click(within(chart).getByRole('button', { name: '导出趋势' }));
    expect(xlsx.json_to_sheet).toHaveBeenCalledWith(expect.arrayContaining([
      { 统计月份: '2026-02', 故障整机: 3 },
    ]));
  });

  it('exports the visible daily trend directly from the dashboard data', async () => {
    render(<MemoryRouter><MFRPage /></MemoryRouter>);
    await screen.findByRole('heading', { name: '现网故障趋势' });
    fireEvent.click(screen.getByRole('button', { name: '导出趋势' }));
    expect(xlsx.json_to_sheet).toHaveBeenCalledWith(expect.arrayContaining([
      { 故障日期: formatLocalDate(new Date()), 故障整机: 8 },
    ]));
    expect(xlsx.book_append_sheet.mock.calls.map(call => call[2])).toEqual(['按日趋势']);
    expect(mfrApi.getExport).not.toHaveBeenCalled();
  });

  it('exports only the fault detail sheet when requested', async () => {
    render(<MemoryRouter><MFRPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '导出故障明细' }));
    await waitFor(() => expect(xlsx.writeFile).toHaveBeenCalled());
    expect(xlsx.book_append_sheet.mock.calls.map(call => call[2])).toEqual(['故障明细']);
    expect(xlsx.aoa_to_sheet).toHaveBeenCalledWith(expect.arrayContaining([
      ['Model A', '2026-01-10', 'KX202601100001', '2026-01-10', '123', 'SN1', 'S1', 'C1', '换上', '2026-12-01', 'PN1', 'PS1', '部件', '客户'],
    ]));
  });

  it('loads details on demand and applies the model and search to the exported rows', async () => {
    const filters = { dateFrom: '2026-01-01', dateTo: '2026-01-31' };
    const record: MFRExport['faultDetails'][number] = {
      model: 'A型', plannedDate: '', shipmentDate: '', productionOrder: '', deviceSn: 'SN1',
      doaCode: 'KX202601100001', faultDate: '2026-01-10', serviceOrder: 'SO1', changeId: 'C1',
      changeType: '换上', occurredAt: '', partNumber: 'P1', partSn: '', partName: '', customer: '',
    };
    vi.mocked(mfrApi.getDashboard).mockResolvedValueOnce(fixture(filters));
    vi.mocked(mfrApi.getExport).mockResolvedValueOnce({
      ...fixture(filters),
      faultDetails: [record, { ...record, changeId: 'C2', faultDate: '2026-01-12' },
        { ...record, model: 'B型', deviceSn: 'SN2', serviceOrder: 'SO2', changeId: 'C3' }],
      deviceIssueDetails: [], changeIssueDetails: [],
    });
    render(<MemoryRouter><MFRPage /></MemoryRouter>);
    const trigger = await screen.findByRole('button', { name: '查看 2026-01 故障明细' });
    expect(mfrApi.getExport).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: '2026-01 故障明细' });
    await within(dialog).findByText('2 台故障整机 · 3 条换件记录');
    fireEvent.change(within(dialog).getByLabelText('机型'), { target: { value: 'A型' } });
    fireEvent.change(within(dialog).getByLabelText('搜索故障明细'), { target: { value: 'so1' } });
    expect(within(dialog).getByText('1 台故障整机 · 2 条换件记录')).toBeTruthy();
    expect(within(dialog).queryByText('SN2')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: '导出筛选结果' }));
    expect(xlsx.aoa_to_sheet.mock.calls.at(-1)?.[0]).toHaveLength(3);
    expect(mfrApi.getExport).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭明细' }));
    expect(screen.queryByRole('dialog', { name: '2026-01 故障明细' })).toBeNull();
  });

  it('uses the first monthly fault date to select devices when opening a daily bar', async () => {
    const filters = { dateFrom: '2026-01-01', dateTo: '2026-01-31' };
    const record: MFRExport['faultDetails'][number] = {
      model: 'A型', plannedDate: '', shipmentDate: '', productionOrder: '', deviceSn: '',
      deviceKey: 'context:1', doaCode: 'KX202601100001', faultDate: '2026-01-10', serviceOrder: 'SO1',
      changeId: 'C1', changeType: '换上', occurredAt: '', partNumber: '', partSn: '', partName: '', customer: '',
    };
    vi.mocked(mfrApi.getDashboard).mockResolvedValueOnce({
      ...fixture(filters), dailyTrend: [{ period: '2026-01-10', faultCount: 1 }],
    });
    vi.mocked(mfrApi.getExport).mockResolvedValueOnce({
      ...fixture(filters), faultDetails: [record,
        { ...record, changeId: 'C2', faultDate: '2026-01-12' },
        { ...record, deviceKey: 'context:2', changeId: 'C3', faultDate: '2026-01-09' },
        { ...record, deviceKey: 'context:2', changeId: 'C4' }],
      deviceIssueDetails: [], changeIssueDetails: [],
    });
    render(<MemoryRouter><MFRPage /></MemoryRouter>);
    await screen.findByRole('heading', { name: '现网故障趋势' });
    fireEvent.click(within(screen.getByTestId('faultCount')).getByRole('button', { name: '测试趋势柱' }));
    const dialog = await screen.findByRole('dialog', { name: '2026-01-10 故障明细' });
    expect(await within(dialog).findByText('1 台故障整机 · 2 条换件记录')).toBeTruthy();
    expect(within(dialog).getByText('2026-01-12')).toBeTruthy();
    expect(within(dialog).queryByText('2026-01-09')).toBeNull();
  });

  it('offers the same daily drill-down through a date selector', async () => {
    vi.mocked(mfrApi.getDashboard).mockImplementationOnce(async filters => ({
      ...fixture(filters),
      dailyTrend: [{ period: '2026-01-10', faultCount: 1 }, { period: '2026-01-11', faultCount: 0 }],
    }));
    render(<MemoryRouter><MFRPage /></MemoryRouter>);
    await screen.findByRole('heading', { name: '现网故障趋势' });
    const select = screen.getByRole('combobox', { name: '查看单日故障明细' });
    expect(within(select).queryByRole('option', { name: /2026-01-11/ })).toBeNull();
    fireEvent.change(select, { target: { value: '2026-01-10' } });
    fireEvent.click(screen.getByRole('button', { name: '查看单日故障' }));
    expect(await screen.findByRole('dialog', { name: '2026-01-10 故障明细' })).toBeTruthy();
  });

  it('shows a calculated MFR and opens excluded date exceptions from the metric', async () => {
    render(<MemoryRouter><MFRPage /></MemoryRouter>);
    const review = await screen.findByRole('button', { name: '查看日期异常（已排除 1 条）' });
    expect(screen.getAllByText('3.00%')).toHaveLength(2);
    fireEvent.click(review);
    const dialog = await screen.findByRole('dialog', { name: 'DOA 申报日期异常' });
    expect(await within(dialog).findByText('D2')).toBeTruthy();
  });

  it('shows the missing shipment denominator when there are no date exceptions', async () => {
    vi.mocked(mfrApi.getDashboard).mockImplementationOnce(async filters => {
      const data = fixture(filters);
      return {
        ...data,
        summary: { ...data.summary, fleetCount: 0, mfrRate: null, deviceIssues: {} },
        trend: data.trend.map(item => ({ ...item, fleetCount: 0, mfrRate: null })),
      };
    });
    render(<MemoryRouter><MFRPage /></MemoryRouter>);
    expect(await screen.findByText('在保窗口内无出货')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '查看日期异常' })).toBeNull();
  });

  it('keeps alerts collapsed and exports the actual excluded records', async () => {
    render(<MemoryRouter><MFRPage /></MemoryRouter>);
    const toggle = await screen.findByText('数据告警');
    expect(toggle.closest('details')?.open).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.closest('details')?.open).toBe(true);
    const panel = screen.getByRole('region', { name: '数据告警详情' });
    expect(within(panel).getByText('设备身份无法确认')).toBeTruthy();
    expect(panel.textContent).toContain('DOA 申报日期无效或冲突');
    fireEvent.click(within(panel).getByRole('button', { name: '导出排查明细' }));
    await waitFor(() => expect(xlsx.writeFile).toHaveBeenCalled());
    expect(xlsx.aoa_to_sheet).toHaveBeenCalledWith(expect.arrayContaining([
      ['设备身份无法确认', 'material:MS1', 'MS1', 'material_sn', 'D1', 'XNC1', 'S1', '判定 是'],
    ]));
    expect(xlsx.aoa_to_sheet).toHaveBeenCalledWith(expect.arrayContaining([
      ['DOA 申报日期无效或冲突', 'C2', 'S2', 'D2', 'product:SN1', 'SN1', 'SN2', '换上', '2026-12-01', 'PN2', 'PS2'],
    ]));
    expect(xlsx.writeFile).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/^MFR排查明细_.*\.xlsx$/));
  });

  it('shows an error instead of fabricated metrics and supports retry', async () => {
    vi.mocked(mfrApi.getDashboard).mockRejectedValueOnce(new Error('接口不可用'));
    render(<MemoryRouter><MFRPage /></MemoryRouter>);
    expect((await screen.findByRole('alert')).textContent).toContain('接口不可用');
    expect(screen.queryByText('质量概览')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('质量概览')).toBeTruthy();
  });
});
