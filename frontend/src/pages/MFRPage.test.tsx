// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { mfrApi } from '../api/mfrApi';
import type { MFRDashboard, MFRFilters } from '../types/mfr';
import { formatLocalDate } from '../utils/dateRange';
import MFRPage from './MFRPage';

const xlsx = vi.hoisted(() => ({
  book_new: vi.fn(() => ({})),
  json_to_sheet: vi.fn((rows: unknown) => rows),
  book_append_sheet: vi.fn(),
  writeFile: vi.fn(),
}));
vi.mock('xlsx', () => ({ utils: xlsx, writeFile: xlsx.writeFile }));
vi.mock('../api/mfrApi', () => ({ mfrApi: { getDashboard: vi.fn() } }));
vi.mock('../components/shared/DashboardSwitcher', () => ({ DashboardSwitcher: () => null }));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => children,
  ComposedChart: ({ children, data }: { children: ReactNode; data: Array<{ period: string }> }) => <div data-testid="trend-chart" data-periods={data.map(item => item.period).join(',')}>{children}</div>,
  Bar: () => null, Line: () => <span data-testid="mfr-line" />,
  CartesianGrid: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null,
}));

const fixture = (filters: MFRFilters): MFRDashboard => ({
  filters,
  summary: { faultCount: 12, fleetCount: 400, mfrRate: 3, sourceDeviceCount: 402, selectedDeviceCount: 400, deviceIssues: { planDateUnresolved: 2 }, unmatchedChangeCount: 1 },
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
    vi.mocked(mfrApi.getDashboard).mockImplementation(async filters => fixture(filters));
  });
  afterEach(cleanup);

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
    await screen.findAllByText('DOA 设备数');
    expect(mfrApi.getDashboard).toHaveBeenCalledWith({
      dateFrom: formatLocalDate(new Date(today.getFullYear(), today.getMonth(), 1)), dateTo: formatLocalDate(today), model: '',
    });
    const fleetMetricHelp = screen.getByRole('button', { name: '查看DOA 设备数说明' });
    fireEvent.focus(fleetMetricHelp);
    expect(screen.getByRole('tooltip').textContent).toContain('不判断是否在保');
    fireEvent.blur(fleetMetricHelp);
    expect(screen.getByText(/数据源中有 2 台设备/)).toBeTruthy();
    const coverageHelp = screen.getByRole('button', { name: '查看未归属设备说明' });
    fireEvent.focus(coverageHelp);
    expect(screen.getByRole('tooltip').textContent).toContain('不受当前日期和机型筛选');
    fireEvent.blur(coverageHelp);
    const trendHelp = screen.getByRole('button', { name: '查看趋势统计方式' });
    expect(screen.queryByText('此处按生产订单计划日期逐日展示关联换件事件，MFR 保持月度口径。')).toBeNull();
    fireEvent.focus(trendHelp);
    expect(screen.getByRole('tooltip').textContent).toBe('此处按生产订单计划日期逐日展示关联换件事件，MFR 保持月度口径。');
    fireEvent.blur(trendHelp);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.getByTestId('trend-chart').getAttribute('data-periods')).toContain(formatLocalDate(today));
    expect(screen.queryByTestId('mfr-line')).toBeNull();
  });

  it('collapses and reopens filters without discarding pending selections', async () => {
    render(<MemoryRouter><MFRPage /></MemoryRouter>);
    await screen.findAllByText('DOA 设备数');
    fireEvent.change(screen.getByLabelText('机型'), { target: { value: 'Model A' } });
    const toggle = screen.getByRole('button', { name: /筛选条件/ });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('机型')).toBeNull();
    expect(toggle.textContent).toContain('待应用');
    fireEvent.click(toggle);
    expect((screen.getByLabelText('机型') as HTMLInputElement).value).toBe('Model A');
    expect(mfrApi.getDashboard).toHaveBeenCalledTimes(1);
  });

  it('switches back to the monthly fault and MFR trend for a multi-month range', async () => {
    render(<MemoryRouter><MFRPage /></MemoryRouter>);
    await screen.findByText('Model A');
    fireEvent.click(screen.getByRole('button', { name: '生产订单计划日期' }));
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-03-31' } });
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    await screen.findByTestId('mfr-line');
    const trendHelp = screen.getByRole('button', { name: '查看趋势统计方式' });
    expect(screen.queryByText(/设备和关联换件事件均按生产订单计划日期归月/)).toBeNull();
    fireEvent.focus(trendHelp);
    expect(screen.getByRole('tooltip').textContent).toContain('设备和关联换件事件均按生产订单计划日期归月');
    expect(screen.getByTestId('trend-chart').getAttribute('data-periods')).toBe('2026-01');
    expect(screen.getByTestId('mfr-line')).toBeTruthy();
  });

  it('drills into a model and resets applied filters while keeping model options', async () => {
    render(<MemoryRouter><MFRPage /></MemoryRouter>);
    await screen.findByText('Model A');
    fireEvent.click(screen.getByRole('button', { name: /Model A/ }));
    expect(screen.getByText('故障事件 10 · DOA 设备数 200')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '查看该机型趋势' }));
    await waitFor(() => expect(mfrApi.getDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'Model A' })));
    await screen.findByText(/数据源中有/);
    expect((screen.getByLabelText('机型') as HTMLInputElement).value).toBe('Model A');
    expect(document.querySelectorAll('#mfr-model-options option')).toHaveLength(2);
    const reset = screen.getByRole('button', { name: '重置筛选' }) as HTMLButtonElement;
    expect(reset.disabled).toBe(false);
    fireEvent.click(reset);
    await waitFor(() => expect(mfrApi.getDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ model: '' })));
  });

  it('exports the applied overview, monthly and model data', async () => {
    render(<MemoryRouter><MFRPage /></MemoryRouter>);
    await screen.findByText('Model A');
    fireEvent.click(within(screen.getByRole('button', { name: '导出统计数据' })).getByText('导出统计数据'));
    expect(xlsx.book_append_sheet.mock.calls.map(call => call[2])).toEqual(['质量概览', '月度明细', '机型汇总']);
    expect(xlsx.json_to_sheet).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ 统计月份: '2026-01', 故障事件: 12, DOA设备数: 400 })]));
    expect(xlsx.writeFile).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/^MFR统计_.*\.xlsx$/));
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
