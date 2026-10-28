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
  ComposedChart: ({ data }: { data: unknown }) => <div data-testid="count-chart">{JSON.stringify(data)}</div>, LineChart: ({ data }: { data: unknown }) => <div data-testid="pn-chart">{JSON.stringify(data)}</div>, Bar: () => null, Line: () => null,
  CartesianGrid: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null,
}));

const cell = { reinsertCount: 2, repairCount: 3, plannedQuantity: 100, plannedRate: 2, usageQuantity: 200, usageRate: 1, usageReason: '' };
const bases = [{
  base: 'B1', months: { '2026-01': cell }, topPns: [{ pn: 'PN1', months: { '2026-01': cell } }],
  components: [{ component: 'CPU', months: { '2026-01': cell }, pns: [{ pn: 'PN1', months: { '2026-01': cell } }] }],
}, {
  base: 'B2', months: { '2026-01': { ...cell, reinsertCount: 4 } }, topPns: [],
  components: [{ component: '主板', months: { '2026-01': cell }, pns: [] }],
}];
const result = { months: ['2026-01'], invalidCount: 1, invalidReinsertCount: 1, bases, models: [
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
