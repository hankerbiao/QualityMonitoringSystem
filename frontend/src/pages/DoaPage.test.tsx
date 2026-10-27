// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { doaApi } from '../api/doaApi';
import * as XLSX from 'xlsx';
import DoaPage from './DoaPage';

vi.mock('../api/doaApi', () => ({
  doaApi: {
    getOptions: vi.fn().mockResolvedValue({ customers: [], models: [] }),
    getDashboard: vi.fn(),
    getAudit: vi.fn(),
    buildQuery: vi.fn().mockReturnValue(''),
  },
}));
vi.mock('../components/shared/DashboardSwitcher', () => ({ DashboardSwitcher: () => null }));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'admin', dashboardPermissions: ['doa', 'doa-repairs'] } }),
}));
vi.mock('xlsx', () => ({
  utils: {
    book_new: vi.fn(() => ({})),
    json_to_sheet: vi.fn((rows) => rows),
    aoa_to_sheet: vi.fn((rows) => rows),
    book_append_sheet: vi.fn(),
  },
  writeFile: vi.fn(),
}));

describe('DoaPage', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('opens the filters on entry', async () => {
    vi.mocked(doaApi.getDashboard).mockRejectedValue(new Error('数据源不可用'));
    render(<MemoryRouter><DoaPage /></MemoryRouter>);

    expect(screen.getByRole('button', { name: /筛选条件/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'SCS 受理日期' })).toBeTruthy();
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(doaApi.getDashboard).toHaveBeenCalledWith(expect.objectContaining({ dateFrom: `${now.getFullYear()}-01-01`, dateTo: today }));
    await screen.findByText('数据源不可用');
  });

  it('does not present zero-valued metrics when loading the dashboard fails', async () => {
    vi.mocked(doaApi.getDashboard).mockRejectedValue(new Error('数据网关缺少实际发货字段'));
    render(<MemoryRouter><DoaPage /></MemoryRouter>);

    expect((await screen.findByRole('alert')).textContent).toContain('数据网关缺少实际发货字段');
    expect(screen.queryByText('出货数量')).toBeNull();
    expect(screen.queryByText('暂无周期趋势数据')).toBeNull();
  });

  it('shows unmatched SCS declarations separately from the matched rate', async () => {
    vi.mocked(doaApi.getDashboard).mockResolvedValue({
      filters: { dateFrom: '', dateTo: '', customer: '', model: '', timeGranularity: 'month' },
      summary: {
        shippedCount: 0, repairCount: 0, repairRate: null,
        replacementCount: 0, replacementRate: null, replacementRecordCount: 0,
        matchedRepairRecords: 0, excludedRepairRecords: 1083, latestDataAt: null,
      },
      trend: [], byCustomer: [], byModel: [],
      unmatchedOrders: [{ salesOrder: 'SO-404', recordCount: 1083 }],
    });
    render(<MemoryRouter><DoaPage /></MemoryRouter>);

    expect(await screen.findByText('SO-404')).toBeTruthy();
    expect(screen.getByText(/未匹配销售订单/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '导出核对数据' })).toBeTruthy();
    expect(screen.getByText(/订单数量代替出货数量/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '导出未匹配订单' }));
    expect(XLSX.utils.json_to_sheet).toHaveBeenCalledWith([{ 销售订单: 'SO-404', 申报条数: 1083 }]);
    expect(XLSX.utils.book_append_sheet).toHaveBeenCalledWith(expect.anything(), expect.anything(), '未匹配销售订单');
    expect(XLSX.writeFile).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/^DOA未匹配销售订单_.*\.xlsx$/));
  });

  it('exports SCS and order source data for reconciliation', async () => {
    vi.mocked(doaApi.getDashboard).mockResolvedValue({
      filters: { dateFrom: '', dateTo: '', customer: '', model: '', timeGranularity: 'month' },
      summary: {
        shippedCount: 20, repairCount: 2, repairRate: 10, replacementCount: 0,
        replacementRate: 0, replacementRecordCount: 0, matchedRepairRecords: 1,
        excludedRepairRecords: 1, latestDataAt: null,
      },
      trend: [], byCustomer: [], byModel: [], unmatchedOrders: [],
    });
    vi.mocked(doaApi.getAudit).mockResolvedValue({
      repairs: [{ matchStatus: '未匹配', salesOrder: '404', id: 'scs-1', acceptedAt: '2026-09-01', repairCount: 2, raw: { shipment_date: '2026-08-01' } }],
      orders: [{ salesOrder: '1', orderQuantity: 20, sourceFields: { data: { original: 'value' } } }],
      changes: [{ service_order: 'scs-1', change_type: '换上' }],
    });
    render(<MemoryRouter><DoaPage /></MemoryRouter>);
    await screen.findByText('匹配订单数量');
    expect((screen.getByRole('button', { name: '导出未匹配订单' }) as HTMLButtonElement).disabled).toBe(true);
    const periodSection = screen.getByRole('heading', { name: '周期明细' }).closest('section')!;
    fireEvent.click(within(periodSection).getByRole('button', { name: '导出核对数据' }));
    await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalled());
    expect(XLSX.utils.book_append_sheet).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'SCS申报');
    expect(XLSX.utils.book_append_sheet).toHaveBeenCalledWith(expect.anything(), expect.anything(), '匹配订单原始行');
    expect(XLSX.utils.book_append_sheet).toHaveBeenCalledWith(expect.anything(), expect.anything(), '关联换件记录');
    expect(XLSX.utils.json_to_sheet).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ salesOrder: '404', shipment_date: '2026-08-01', matchStatus: '未匹配' })]));
  });

  it('sorts the ranking by the selected metric and shows its order sample', async () => {
    vi.mocked(doaApi.getDashboard).mockResolvedValue({
      filters: { dateFrom: '', dateTo: '', customer: '', model: '', timeGranularity: 'month' },
      summary: {
        shippedCount: 120, repairCount: 10, repairRate: 8.33, replacementCount: 3,
        replacementRate: 2.5, replacementRecordCount: 2, matchedRepairRecords: 4,
        excludedRepairRecords: 0, latestDataAt: null,
      },
      trend: [], byModel: [
        { key: 'M1', shippedCount: 120, repairCount: 11, repairRate: 9.17, replacementCount: 3, replacementRate: 2.5 },
      ], unmatchedOrders: [],
      byCustomer: [
        { key: '客户 A', shippedCount: 100, repairCount: 10, repairRate: 10, replacementCount: 1, replacementRate: 1 },
        { key: '客户 B', shippedCount: 20, repairCount: 1, repairRate: 5, replacementCount: 2, replacementRate: 10 },
      ],
    });
    render(<MemoryRouter><DoaPage /></MemoryRouter>);

    await screen.findByText('客户 A');
    const ranking = screen.getByText('维度排行').parentElement!.parentElement!;
    expect(within(ranking).getByText('订单 100')).toBeTruthy();
    expect(within(ranking).getByText('客户 A').compareDocumentPosition(within(ranking).getByText('客户 B')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(ranking).getByRole('button', { name: '换件率' }));
    expect(within(ranking).getByText('客户 B').compareDocumentPosition(within(ranking).getByText('客户 A')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(ranking).getByRole('button', { name: '客户 B 查看详情' }));
    expect(within(ranking).getByText('问题批次数量')).toBeTruthy();
    expect(within(ranking).getByRole('link', { name: /报修明细/ })).toBeTruthy();
    expect(within(ranking).getByRole('link', { name: /换件明细/ })).toBeTruthy();
    expect(doaApi.buildQuery).toHaveBeenCalledWith(expect.objectContaining({ customers: ['客户 B'], customer: '' }));
    fireEvent.click(within(ranking).getByRole('button', { name: '客户 B 收起详情' }));
    expect(within(ranking).queryByText('问题批次数量')).toBeNull();
    fireEvent.click(within(ranking).getByRole('button', { name: '机型' }));
    fireEvent.click(within(ranking).getByRole('button', { name: 'M1 查看详情' }));
    expect(doaApi.buildQuery).toHaveBeenCalledWith(expect.objectContaining({ models: ['M1'], model: '' }));
  });

  it('keeps the latest filter result when requests finish out of order', async () => {
    const dashboard = (count: number) => ({
      filters: { dateFrom: '', dateTo: '', customer: '', model: '', timeGranularity: 'month' as const },
      summary: {
        shippedCount: count, repairCount: 0, repairRate: 0, replacementCount: 0,
        replacementRate: 0, replacementRecordCount: 0, matchedRepairRecords: 0,
        excludedRepairRecords: 0, latestDataAt: null,
      },
      trend: [], byCustomer: [], byModel: [], unmatchedOrders: [],
    });
    let resolveFirst!: (value: ReturnType<typeof dashboard>) => void;
    vi.mocked(doaApi.getOptions).mockResolvedValueOnce({ customers: ['客户 A'], models: [] });
    vi.mocked(doaApi.getDashboard)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(dashboard(222));
    render(<MemoryRouter><DoaPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: '客户（多选）' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: '客户 A' }));
    await screen.findByText('222');
    await act(async () => { resolveFirst(dashboard(111)); });
    expect(screen.queryByText('111')).toBeNull();
    expect(screen.getByText('222')).toBeTruthy();
  });

  it('supports selecting multiple customers and models', async () => {
    vi.mocked(doaApi.getOptions).mockResolvedValueOnce({ customers: ['客户 A', '客户 B'], models: ['M1', 'M2'] });
    vi.mocked(doaApi.getDashboard).mockResolvedValue({
      filters: { dateFrom: '', dateTo: '', customer: '', model: '', timeGranularity: 'month' },
      summary: { shippedCount: 0, repairCount: 0, repairRate: null, replacementCount: 0, replacementRate: null, replacementRecordCount: 0, matchedRepairRecords: 0, excludedRepairRecords: 0, latestDataAt: null },
      trend: [], byCustomer: [], byModel: [], unmatchedOrders: [],
    });
    render(<MemoryRouter><DoaPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '客户（多选）' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: '客户 A' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '客户 B' }));
    fireEvent.click(screen.getByRole('button', { name: '机型（多选）' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'M1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'M2' }));
    await waitFor(() => expect(doaApi.getDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ customers: ['客户 A', '客户 B'], models: ['M1', 'M2'] })));
  });

  it('uses daily trends for a month and respects an explicit granularity in links', async () => {
    vi.mocked(doaApi.getDashboard).mockRejectedValue(new Error('数据源不可用'));
    const first = render(<MemoryRouter initialEntries={['/doa?dateFrom=2026-03-01&dateTo=2026-03-31']}><DoaPage /></MemoryRouter>);
    await screen.findByText('数据源不可用');
    expect(doaApi.getDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ timeGranularity: 'day' }));
    first.unmount();

    render(<MemoryRouter initialEntries={['/doa?dateFrom=2026-03-01&dateTo=2026-03-31&timeGranularity=month']}><DoaPage /></MemoryRouter>);
    await screen.findByText('数据源不可用');
    expect(doaApi.getDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ timeGranularity: 'month' }));
  });

  it('adjusts trend granularity when the date range changes', async () => {
    vi.mocked(doaApi.getDashboard).mockRejectedValue(new Error('数据源不可用'));
    render(<MemoryRouter><DoaPage /></MemoryRouter>);
    await screen.findByText('数据源不可用');
    fireEvent.click(screen.getByRole('button', { name: 'SCS 受理日期' }));
    fireEvent.click(screen.getByRole('button', { name: '近 30 天' }));
    await waitFor(() => expect(doaApi.getDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ timeGranularity: 'day' })));
    await screen.findByText('数据源不可用');
    expect(screen.queryByLabelText('趋势粒度')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'SCS 受理日期' }));
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-03-01' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-04-01' } });
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(doaApi.getDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ timeGranularity: 'month' }));
  });
});
