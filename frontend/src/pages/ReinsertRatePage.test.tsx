// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reinsertApi } from '../api/reinsertApi';
import ReinsertRatePage from './ReinsertRatePage';

vi.mock('../api/reinsertApi', () => ({ reinsertApi: { options: vi.fn(), dashboard: vi.fn(), details: vi.fn() } }));
vi.mock('../components/shared/DashboardSwitcher', () => ({ DashboardSwitcher: () => null }));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ComposedChart: () => null, LineChart: () => null, Bar: () => null, Line: () => null,
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

  it('defaults to the most recent 30 days, including today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 31, 12));
    render(<MemoryRouter><ReinsertRatePage /></MemoryRouter>);
    expect(reinsertApi.dashboard).toHaveBeenCalledWith({ dateFrom: '2026-03-02', dateTo: '2026-03-31' });
    expect(screen.getByRole('button', { name: '订单计划日期' }).getAttribute('title')).toBe('2026-03-02 至 2026-03-31');
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
});
