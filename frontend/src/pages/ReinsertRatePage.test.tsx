// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reinsertApi } from '../api/reinsertApi';
import ReinsertRatePage from './ReinsertRatePage';
import * as XLSX from 'xlsx';

vi.mock('xlsx', async importOriginal => ({ ...await importOriginal<typeof import('xlsx')>(), writeFile: vi.fn() }));
vi.mock('../api/reinsertApi', () => ({ reinsertApi: { options: vi.fn(), dashboard: vi.fn(), details: vi.fn() } }));
vi.mock('../components/shared/DashboardSwitcher', () => ({ DashboardSwitcher: () => null }));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ComposedChart: ({ data, children }: { data: unknown; children: React.ReactNode }) => <div data-testid="count-chart">{JSON.stringify(data)}{children}</div>, LineChart: ({ data, children }: { data: Record<string, unknown>[]; children: React.ReactNode }) => <div data-testid={data.some(row => 'component0' in row) ? 'component-chart' : 'pn-chart'}>{JSON.stringify(data)}{children}</div>, Bar: ({ dataKey }: { dataKey: string }) => <span data-series={dataKey} />, Line: ({ dataKey }: { dataKey: string }) => <span data-series={dataKey} />,
  CartesianGrid: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null,
  BarChart: ({ data, children }: { data: unknown; children: React.ReactNode }) => <div data-testid="base-comparison-chart">{JSON.stringify(data)}{children}</div>,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, Pie: () => null, Cell: () => null,
}));

const cell = { reinsertCount: 2, repairCount: 3, plannedQuantity: 100, plannedRate: 2, usageQuantity: 200, usageRate: 1, usageReason: '' };
const bases = [{
  base: 'B1', months: { '2026-01': cell }, topPns: [{ pn: 'PN1', months: { '2026-01': cell } }],
  components: [{ component: 'CPU', months: { '2026-01': cell }, pns: [{ pn: 'PN1', months: { '2026-01': cell } }] }],
}, {
  base: 'B2', months: { '2026-01': { ...cell, reinsertCount: 4 } }, topPns: [],
  components: [{ component: '主板', months: { '2026-01': cell }, pns: [] }],
}];
const result = { months: ['2026-01'], invalidCount: 1, invalidReinsertCount: 1, defectResponsibilities: [{ name: '生产', count: 2 }, { name: '未填写', count: 1 }], bases, models: [
  { model: 'M1', bases },
  { model: 'M2', bases: [{ ...bases[0], components: [] }] },
] };

describe('重插率分析', () => {
  beforeEach(() => {
    vi.mocked(reinsertApi.options).mockResolvedValue({ bases: ['B1', 'B2'], customers: [], productModels: [] });
    vi.mocked(reinsertApi.dashboard).mockResolvedValue(result);
    vi.mocked(reinsertApi.details).mockResolvedValue({ items: [{ SN: 'S1', NG工站: 'OP1', 记录数: 1, 维修记录: [] }], total: 1, page: 1, pageSize: 50 });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

  it('shows fault responsibility counts and percentages for the applied results', async () => {
    render(<MemoryRouter><ReinsertRatePage /></MemoryRouter>);
    expect(await screen.findByRole('img', { name: '维修故障缺陷责任分类饼图' })).toBeTruthy();
    expect(screen.getByText('2 条 · 66.7%')).toBeTruthy();
    expect(screen.getByText('1 条 · 33.3%')).toBeTruthy();
  });

  it('plots each selected base component using monthly reinsert counts', async () => {
    const trendBase = { ...bases[0], months: { '2026-01': cell, '2026-02': cell }, components: [
      { ...bases[0].components[0], months: { '2026-01': cell, '2026-02': { ...cell, reinsertCount: 7 } } },
      { component: '内存', months: { '2026-01': { ...cell, reinsertCount: 4 }, '2026-02': cell }, pns: [] },
    ] };
    vi.mocked(reinsertApi.dashboard).mockResolvedValue({ ...result, months: ['2026-01', '2026-02'], models: [{ model: 'M1', bases: [trendBase] }] });
    render(<MemoryRouter><ReinsertRatePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '查看M1 B1基地详情' }));
    expect(screen.getByRole('img', { name: 'B1部件月度重插数趋势' })).toBeTruthy();
    expect(JSON.parse(screen.getByTestId('component-chart').textContent || '[]')).toEqual([
      { period: '2026-01', component0: 2, component1: 4 },
      { period: '2026-02', component0: 7, component1: 2 },
    ]);
  });

  it('compares the aggregated bases by month and switches between counts and rates', async () => {
    const aggregateBases = [
      { ...bases[0], months: { '2026-01': cell, '2026-02': { ...cell, reinsertCount: 5, plannedRate: null } } },
      { ...bases[1], months: { '2026-01': { ...cell, reinsertCount: 7, plannedRate: 3.5 }, '2026-02': cell } },
    ];
    vi.mocked(reinsertApi.dashboard).mockResolvedValue({ ...result, bases: aggregateBases, models: [{ model: 'M1', bases: aggregateBases }], months: ['2026-01', '2026-02'] });
    render(<MemoryRouter><ReinsertRatePage /></MemoryRouter>);
    const chart = await screen.findByTestId('base-comparison-chart');
    expect(JSON.parse(chart.textContent || '[]')).toEqual([
      { base: 'B1', month0: 2, month1: 5 }, { base: 'B2', month0: 7, month1: 2 },
    ]);
    fireEvent.change(screen.getByLabelText('对比指标'), { target: { value: 'plannedRate' } });
    expect(JSON.parse(chart.textContent || '[]')).toEqual([
      { base: 'B1', month0: 2, month1: null }, { base: 'B2', month0: 3.5, month1: 2 },
    ]);
    fireEvent.click(within(screen.getByRole('group', { name: '选择月份' })).getByRole('checkbox', { name: '2026-01' }));
    expect(chart.querySelector('[data-series="month0"]')).toBeNull();
    expect(chart.querySelector('[data-series="month1"]')).toBeTruthy();
  });

  it('independently toggles chart series without changing the table', async () => {
    render(<MemoryRouter><ReinsertRatePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '查看M1 B1基地详情' }));
    const metrics = screen.getByRole('group', { name: '选择重插指标' });
    const pns = screen.getByRole('group', { name: '选择 PN' });
    const components = screen.getByRole('group', { name: '选择部件' });
    fireEvent.click(within(metrics).getByRole('checkbox', { name: '重插数' }));
    fireEvent.click(within(pns).getByRole('checkbox', { name: 'PN1' }));
    fireEvent.click(within(components).getByRole('checkbox', { name: 'CPU' }));
    expect(screen.getByTestId('count-chart').querySelector('[data-series="count"]')).toBeNull();
    expect(screen.getByTestId('count-chart').querySelector('[data-series="rate"]')).toBeTruthy();
    expect(screen.getByTestId('pn-chart').querySelector('[data-series="pn0"]')).toBeNull();
    expect(screen.getByTestId('component-chart').querySelector('[data-series="component0"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'CPU' })).toBeTruthy();
    fireEvent.click(within(components).getByRole('checkbox', { name: 'CPU' }));
    expect(screen.getByTestId('component-chart').querySelector('[data-series="component0"]')).toBeTruthy();
  });

  it('plots components by day for a single-month query', async () => {
    const dailyBase = { ...bases[0], days: { '2026-01-01': cell, '2026-01-02': cell }, components: [
      { ...bases[0].components[0], dailyReinsertCounts: { '2026-01-01': 3, '2026-01-02': 0 } },
    ] };
    vi.mocked(reinsertApi.dashboard).mockResolvedValue({ ...result, models: [{ model: 'M1', bases: [dailyBase] }] });
    render(<MemoryRouter><ReinsertRatePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '查看M1 B1基地详情' }));
    expect(screen.getByRole('img', { name: 'B1部件每日重插数趋势' })).toBeTruthy();
    expect(JSON.parse(screen.getByTestId('component-chart').textContent || '[]')).toEqual([
      { period: '2026-01-01', component0: 3 }, { period: '2026-01-02', component0: 0 },
    ]);
  });

  it('exports the applied results with monthly summaries and component and PN data', async () => {
    const incomplete = { ...cell, plannedRate: null, usageQuantity: null, usageRate: null, usageReason: '缺少发料' };
    const exportBase = { ...bases[0], components: [{ component: 'CPU', months: { '2026-01': cell }, pns: [{ pn: 'PN1', months: { '2026-01': incomplete } }] }] };
    vi.mocked(reinsertApi.dashboard).mockResolvedValue({ ...result, models: [{ model: '', bases: [exportBase] }, { model: 'M2', bases: [bases[1]] }] });
    render(<MemoryRouter><ReinsertRatePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '导出 Excel' }));
    await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalledOnce());
    const workbook = vi.mocked(XLSX.writeFile).mock.calls[0][0];
    const summary = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['机型基地汇总']);
    expect(summary).toEqual(expect.arrayContaining([
      expect.objectContaining({ 机型: '未填写机型', 基地: 'B1', 月份: '2026-01', 重插数: 2, 整机重插率: 2 }),
      expect.objectContaining({ 机型: 'M2', 基地: 'B2', 月份: '2026-01', 重插数: 4 }),
    ]));
    const details = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['部件PN汇总'], { defval: null });
    expect(details).toEqual(expect.arrayContaining([
      expect.objectContaining({ 机型: '未填写机型', 基地: 'B1', 部件: 'CPU', PN: 'PN1', 整机重插率: null, PN净发料: null, PN使用重插率: null, 说明: '缺少发料' }),
    ]));
  });

  it('exports the last applied filters and daily chart data even when the date draft changes', async () => {
    const dailyBase = { ...bases[0], days: { '2026-01-01': cell }, topPns: [{ pn: 'PN1', months: { '2026-01': cell }, days: { '2026-01-01': cell } }] };
    vi.mocked(reinsertApi.dashboard).mockResolvedValue({ ...result, models: [{ model: 'M1', bases: [dailyBase] }] });
    render(<MemoryRouter><ReinsertRatePage /></MemoryRouter>);
    await screen.findByRole('button', { name: '查看M1 B1基地详情' });
    const initial = vi.mocked(reinsertApi.dashboard).mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: '订单计划日期' }));
    fireEvent.click(screen.getByRole('button', { name: '昨天' }));
    fireEvent.click(screen.getByRole('button', { name: '导出 Excel' }));
    await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalledOnce());
    const [workbook, filename] = vi.mocked(XLSX.writeFile).mock.calls[0];
    expect(filename).toBe(`重插率分析_${initial.dateFrom}_${initial.dateTo}.xlsx`);
    expect(XLSX.utils.sheet_to_json(workbook.Sheets['每日趋势'])).toEqual([
      expect.objectContaining({ 机型: 'M1', 基地: 'B1', 日期: '2026-01-01', 类型: '基地', 重插数: 2 }),
      expect.objectContaining({ 类型: 'PN Top 5', PN: 'PN1', 整机重插率: 2 }),
    ]);
  });

  it('exports every page of fault records using the applied query', async () => {
    vi.mocked(reinsertApi.details)
      .mockResolvedValueOnce({ items: [{ PCODE: 'SN1', ZNGWD3: '故障一', source: { site: 'MES' } }], total: 2, page: 1, pageSize: 200 })
      .mockResolvedValueOnce({ items: [{ PCODE: '', ZNGWD3: '故障二' }], total: 2, page: 2, pageSize: 200 });
    render(<MemoryRouter><ReinsertRatePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '导出 Excel' }));
    await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalledOnce());
    const applied = vi.mocked(reinsertApi.dashboard).mock.calls[0][0];
    expect(reinsertApi.details).toHaveBeenNthCalledWith(1, { ...applied, kind: 'faults' }, 1, 200);
    expect(reinsertApi.details).toHaveBeenNthCalledWith(2, { ...applied, kind: 'faults' }, 2, 200);
    const workbook = vi.mocked(XLSX.writeFile).mock.calls[0][0];
    expect(XLSX.utils.sheet_to_json(workbook.Sheets['故障明细'])).toEqual([
      { PCODE: 'SN1', ZNGWD3: '故障一', 'source.site': 'MES' },
      { PCODE: '', ZNGWD3: '故障二' },
    ]);
  });

  it('does not export a partial workbook when fault details fail', async () => {
    vi.mocked(reinsertApi.details).mockRejectedValueOnce(new Error('故障数据不可用'));
    render(<MemoryRouter><ReinsertRatePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '导出 Excel' }));
    expect((await screen.findByRole('alert')).textContent).toContain('故障数据不可用');
    expect(XLSX.writeFile).not.toHaveBeenCalled();
  });

  it('defaults to the most recent 7 days, including today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 3, 12));
    render(<MemoryRouter><ReinsertRatePage /></MemoryRouter>);
    expect(reinsertApi.dashboard).toHaveBeenCalledWith({ dateFrom: '2025-12-28', dateTo: '2026-01-03' });
    expect(screen.getByRole('button', { name: '订单计划日期' }).getAttribute('title')).toBe('2025-12-28 至 2026-01-03');
  });

  it('expands component PN and opens the correct detail with applied filters', async () => {
    render(<MemoryRouter><ReinsertRatePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '查看M1 B1基地详情' }));
    fireEvent.click(await screen.findByRole('button', { name: 'CPU' }));
    fireEvent.click(screen.getByRole('button', { name: 'B1 PN1 2026-01 PN使用重插率明细' }));
    const dialog = screen.getByRole('dialog', { name: '重插事件' });
    await within(dialog).findByText('S1');
    expect(reinsertApi.details).toHaveBeenCalledWith(expect.objectContaining({
      model: 'M1', base: 'B1', month: '2026-01', component: 'CPU', pn: 'PN1', kind: 'reinsert',
    }), 1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows all bases in the overview and switches between individual base views', async () => {
    render(<MemoryRouter><ReinsertRatePage /></MemoryRouter>);
    const first = await screen.findByRole('button', { name: '查看M1 B1基地详情' });
    expect(screen.getByRole('button', { name: '查看M1 B2基地详情' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '查看M2 B1基地详情' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'CPU' })).toBeNull();
    fireEvent.click(first);
    expect(screen.getByRole('button', { name: 'CPU' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '主板' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '机型与基地汇总' }));
    fireEvent.click(screen.getByRole('button', { name: '查看M1 B2基地详情' }));
    expect(screen.getByRole('button', { name: '主板' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'CPU' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '机型与基地汇总' }));
    fireEvent.click(screen.getByRole('button', { name: 'M2 B1 2026-01 重插数明细' }));
    await waitFor(() => expect(reinsertApi.details).toHaveBeenCalledWith(expect.objectContaining({
      model: 'M2', base: 'B1', month: '2026-01', kind: 'reinsert',
    }), 1));
  });

  it('shows errors and allows retry', async () => {
    vi.mocked(reinsertApi.dashboard).mockRejectedValueOnce(new Error('数据源不可用'));
    render(<MemoryRouter><ReinsertRatePage /></MemoryRouter>);
    expect((await screen.findByRole('alert')).textContent).toContain('数据源不可用');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '查看M1 B1基地详情' })).toBeTruthy());
  });

  it('uses daily trend data for a single month and keeps monthly table data', async () => {
    const dailyBase = { ...bases[0], days: { '2026-01-01': cell, '2026-01-02': { ...cell, reinsertCount: 0, plannedRate: null } }, topPns: [{ pn: 'PN1', months: { '2026-01': cell }, days: { '2026-01-01': cell, '2026-01-02': { ...cell, plannedRate: null } } }] };
    vi.mocked(reinsertApi.dashboard).mockResolvedValue({ ...result, models: [{ model: 'M1', bases: [dailyBase] }] });
    render(<MemoryRouter><ReinsertRatePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '查看M1 B1基地详情' }));
    expect(screen.getByText('每日重插数与整机口径重插率')).toBeTruthy();
    expect(screen.getByText('PN Top 5 每日重插率')).toBeTruthy();
    expect(JSON.parse(screen.getByTestId('count-chart').textContent || '[]')).toEqual([
      { period: '2026-01-01', count: 2, rate: 2 }, { period: '2026-01-02', count: 0, rate: null },
    ]);
    expect(JSON.parse(screen.getByTestId('pn-chart').textContent || '[]')[1].pn0).toBeNull();
    expect(screen.getByText('2026-01')).toBeTruthy();
  });

  it('shows repair descriptions and exports each original record across pages', async () => {
    const first = { PCODE: 'S1', ZNGWD3: '内存数量比对报错', ZWXWD3: '重插内存', AUFNR: '0001', extra: { source: 'MES' } };
    const second = { PCODE: 'S1', ZNGWD3: '故障二', ZWXWD3: '重插部件', AUFNR: '0002', additional: '原始字段' };
    const group = { SN: 'S1', NG工站: 'OP1', 记录数: 2, 维修记录: [first, second] };
    vi.mocked(reinsertApi.details).mockResolvedValueOnce({ items: [group], total: 2, page: 1, pageSize: 50 })
      .mockResolvedValueOnce({ items: [group], total: 2, page: 1, pageSize: 200 })
      .mockResolvedValueOnce({ items: [{ SN: 'S2', NG工站: 'OP2', 记录数: 1, 维修记录: [{ PCODE: 'S2', ZWXWD3: '重插' }] }], total: 2, page: 2, pageSize: 200 });
    render(<MemoryRouter><ReinsertRatePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'M1 B1 2026-01 重插数明细' }));
    const dialog = screen.getByRole('dialog', { name: '重插事件' });
    expect(await within(dialog).findByText('内存数量比对报错')).toBeTruthy();
    expect(within(dialog).getByText('重插内存')).toBeTruthy();
    expect(within(dialog).getByText('故障二')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '导出明细' }));
    await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalledOnce());
    const workbook = vi.mocked(XLSX.writeFile).mock.calls[0][0];
    expect(XLSX.utils.sheet_to_json(workbook.Sheets['明细'])).toEqual([
      { PCODE: 'S1', ZNGWD3: '内存数量比对报错', ZWXWD3: '重插内存', AUFNR: '0001', 'extra.source': 'MES' },
      { PCODE: 'S1', ZNGWD3: '故障二', ZWXWD3: '重插部件', AUFNR: '0002', additional: '原始字段' },
      { PCODE: 'S2', ZWXWD3: '重插' },
    ]);
  });
});
