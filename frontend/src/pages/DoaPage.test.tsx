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
    getAllOrders: vi.fn(),
    getAllRepairs: vi.fn(),
    buildQuery: vi.fn().mockReturnValue(''),
  },
}));
vi.mock('../components/shared/DashboardSwitcher', () => ({ DashboardSwitcher: () => null }));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'test-user', role: 'admin', dashboardPermissions: ['doa', 'doa-repairs'] } }),
}));
vi.mock('xlsx', () => ({
  utils: {
    book_new: vi.fn(() => ({ Sheets: {} })),
    json_to_sheet: vi.fn((rows) => rows),
    aoa_to_sheet: vi.fn((rows) => rows),
    encode_range: vi.fn(() => 'A1:B2'),
    encode_cell: vi.fn(() => 'A1'),
    book_append_sheet: vi.fn((book, sheet, name) => { book.Sheets[name] = sheet; }),
  },
  writeFile: vi.fn(),
}));

describe('DoaPage', () => {
  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it('shows the dashboard loading state until a request fails', async () => {
    let reject!: (error: Error) => void;
    vi.mocked(doaApi.getDashboard).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    render(<MemoryRouter><DoaPage /></MemoryRouter>);
    expect(screen.getByRole('status', { name: '正在加载 DOA 看板数据' })).toBeTruthy();
    expect(screen.queryByLabelText('质量概览指标')).toBeNull();
    reject(new Error('数据加载失败'));
    expect((await screen.findByRole('alert')).textContent).toContain('数据加载失败');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('opens the filters on entry', async () => {
    vi.mocked(doaApi.getDashboard).mockRejectedValue(new Error('数据源不可用'));
    render(<MemoryRouter><DoaPage /></MemoryRouter>);

    expect(screen.getByRole('button', { name: /筛选条件/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: '生产订单计划开始日期' })).toBeTruthy();
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    expect(doaApi.getDashboard).toHaveBeenCalledWith(expect.objectContaining({ dateFrom: monthStart, dateTo: today, timeGranularity: 'day' }));
    await screen.findByText('数据源不可用');
  });

  it('reuses dashboard and options after reopening with the same filters', async () => {
    vi.mocked(doaApi.getDashboard).mockResolvedValueOnce({
      filters: { dateFrom: '', dateTo: '', customer: '', model: '', timeGranularity: 'month' },
      cacheExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      summary: { shippedCount: 10, repairCount: 1, repairRate: 10, replacementCount: 0,
        replacementRate: 0, replacementRecordCount: 0, matchedRepairRecords: 1,
        excludedRepairRecords: 0, unmatchedRepairRecords: 0, missingQuantityRecords: 0,
        unmatchedPlannedRecords: 0, unmatchedPlannedQuantity: 0, latestDataAt: null },
      trend: [], byCustomer: [], byModel: [], unmatchedOrders: [],
    });
    const first = render(<MemoryRouter><DoaPage /></MemoryRouter>);
    await screen.findByText('10.00%');
    first.unmount();
    render(<MemoryRouter><DoaPage /></MemoryRouter>);
    await screen.findByText('10.00%');
    expect(doaApi.getDashboard).toHaveBeenCalledTimes(1);
    expect(doaApi.getOptions).toHaveBeenCalledTimes(1);
  });

  it('exports a detailed workbook using the current dashboard filters', async () => {
    vi.mocked(doaApi.getDashboard).mockResolvedValueOnce({
      filters: { dateFrom: '', dateTo: '', customer: '', model: '', timeGranularity: 'month' },
      summary: { shippedCount: 10, repairCount: 2, repairRate: 20, replacementCount: 2, replacementRate: 20, replacementRecordCount: 1, matchedRepairRecords: 1, excludedRepairRecords: 0, unmatchedRepairRecords: 0, missingQuantityRecords: 0, unmatchedPlannedRecords: 0, unmatchedPlannedQuantity: 0, latestDataAt: null },
      trend: [], byCustomer: [], byModel: [], unmatchedOrders: [],
    });
    vi.mocked(doaApi.getAllOrders).mockResolvedValueOnce([{ salesOrder: '1', productionOrder: '2', customer: '甲', model: 'M1', plannedStartDate: '2026-10-01', quantity: 10 }]);
    const repair = { id: '1', salesOrder: '1', materialSerial: 'SN', acceptedAt: '', plannedAt: '2026-10-01', gstrsStatus: 'matched', customer: '甲', model: 'M1', shippedDate: '', shippedCount: 10, repairCount: 2, missingQuantity: false, data: {} };
    vi.mocked(doaApi.getAllRepairs).mockResolvedValueOnce([repair]).mockResolvedValueOnce([repair]).mockResolvedValueOnce([]);
    render(<MemoryRouter><DoaPage /></MemoryRouter>);
    await screen.findAllByText('20.00%');
    fireEvent.click(screen.getByRole('button', { name: '导出 Excel' }));
    await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalled());
    expect(doaApi.getAllOrders).toHaveBeenCalledWith(expect.objectContaining({ timeGranularity: 'day' }));
    expect(doaApi.getAllRepairs).toHaveBeenCalledTimes(3);
    expect(XLSX.utils.book_append_sheet).toHaveBeenCalledWith(expect.anything(), expect.anything(), '报修明细');
    expect(XLSX.utils.book_append_sheet).toHaveBeenCalledWith(expect.anything(), expect.anything(), '未匹配计划日期');
  });

  it('does not export when the current details no longer match the dashboard', async () => {
    vi.mocked(doaApi.getDashboard).mockResolvedValueOnce({
      filters: { dateFrom: '', dateTo: '', customer: '', model: '', timeGranularity: 'day' },
      summary: { shippedCount: 10, repairCount: 0, repairRate: 0, replacementCount: 0, replacementRate: 0, replacementRecordCount: 0, matchedRepairRecords: 0, excludedRepairRecords: 0, unmatchedRepairRecords: 0, missingQuantityRecords: 0, unmatchedPlannedRecords: 0, unmatchedPlannedQuantity: 0, latestDataAt: null },
      trend: [], byCustomer: [], byModel: [], unmatchedOrders: [],
    });
    vi.mocked(doaApi.getAllOrders).mockResolvedValueOnce([]);
    vi.mocked(doaApi.getAllRepairs).mockResolvedValue([]);
    render(<MemoryRouter><DoaPage /></MemoryRouter>);
    await screen.findByText('到货数据（计划数量）');
    fireEvent.click(screen.getByRole('button', { name: '导出 Excel' }));
    expect((await screen.findByRole('alert')).textContent).toContain('看板与明细数据已发生变化');
    expect(XLSX.writeFile).not.toHaveBeenCalled();
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
        matchedRepairRecords: 0, excludedRepairRecords: 0, unmatchedRepairRecords: 1083, missingQuantityRecords: 0, unmatchedPlannedRecords: 0, unmatchedPlannedQuantity: 0, latestDataAt: null,
      },
      trend: [], byCustomer: [], byModel: [],
      unmatchedOrders: [{ salesOrder: 'SO-404', recordCount: 1083 }],
    });
    render(<MemoryRouter><DoaPage /></MemoryRouter>);

    const unmatchedButton = await screen.findByRole('button', { name: '未匹配数据' });
    expect(unmatchedButton.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('未匹配数据')).toBeNull();
    fireEvent.click(unmatchedButton);
    expect(unmatchedButton.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('SO-404')).toBeTruthy();
    expect(screen.getByText(/未匹配销售订单/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '导出核对数据' })).toBeTruthy();
    const trendHelp = screen.getByRole('button', { name: '查看报修与换件趋势说明' });
    fireEvent.mouseEnter(trendHelp.parentElement!);
    expect(screen.getByRole('tooltip').textContent).toContain('当期报修问题批次数量 ÷ 当期订单计划数量');
    fireEvent.mouseLeave(trendHelp.parentElement!);
    const matchedHelp = screen.getByRole('button', { name: '查看已匹配 DOA说明' });
    fireEvent.focus(matchedHelp);
    expect(screen.getByRole('tooltip').textContent).toContain('申报条数');
    fireEvent.blur(matchedHelp);
    const periodHelp = screen.getByRole('button', { name: '查看周期明细说明' });
    expect(screen.queryByText(/计划数量不是实际发货量/)).toBeNull();
    fireEvent.focus(periodHelp);
    expect(screen.getByRole('tooltip').textContent).toContain('计划数量不是实际发货量');
    fireEvent.blur(periodHelp);
    fireEvent.click(screen.getByRole('button', { name: '导出未匹配订单' }));
    expect(XLSX.utils.json_to_sheet).toHaveBeenCalledWith([{ 销售订单: 'SO-404', 申报条数: 1083 }]);
    expect(XLSX.utils.book_append_sheet).toHaveBeenCalledWith(expect.anything(), expect.anything(), '未匹配销售订单');
    fireEvent.click(unmatchedButton);
    expect(unmatchedButton.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('未匹配数据')).toBeNull();
    expect(XLSX.writeFile).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/^DOA未匹配销售订单_.*\.xlsx$/));
  });

  it('exports SCS and order source data for reconciliation', async () => {
    vi.mocked(doaApi.getDashboard).mockResolvedValue({
      filters: { dateFrom: '', dateTo: '', customer: '', model: '', timeGranularity: 'month' },
      summary: {
        shippedCount: 20, repairCount: 2, repairRate: 10, replacementCount: 0,
        replacementRate: 0, replacementRecordCount: 0, matchedRepairRecords: 1,
        excludedRepairRecords: 1, unmatchedRepairRecords: 0, missingQuantityRecords: 0, unmatchedPlannedRecords: 0, unmatchedPlannedQuantity: 0, latestDataAt: null,
      },
      trend: [], byCustomer: [], byModel: [], unmatchedOrders: [],
    });
    vi.mocked(doaApi.getAudit).mockResolvedValue({
      repairs: [{ matchStatus: '未匹配', salesOrder: '404', id: 'scs-1', acceptedAt: '2026-09-01', repairCount: 2, raw: { shipment_date: '2026-08-01' } }],
      orders: [{ salesOrder: '1', orderQuantity: 20, sourceFields: { data: { original: 'value' } } }],
      changes: [{ service_order: 'scs-1', change_type: '换上' }],
    });
    render(<MemoryRouter><DoaPage /></MemoryRouter>);
    await screen.findByText('到货数据（计划数量）');
    fireEvent.click(screen.getByRole('button', { name: '未匹配数据' }));
    expect((screen.getByRole('button', { name: '导出未匹配订单' }) as HTMLButtonElement).disabled).toBe(true);
    const periodSection = screen.getByRole('heading', { name: '周期明细' }).closest('section')!;
    fireEvent.click(within(periodSection).getByRole('button', { name: '导出核对数据' }));
    await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalled());
    expect(XLSX.utils.book_append_sheet).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'SCS申报');
    expect(XLSX.utils.book_append_sheet).toHaveBeenCalledWith(expect.anything(), expect.anything(), '分母订单原始行');
    expect(XLSX.utils.book_append_sheet).toHaveBeenCalledWith(expect.anything(), expect.anything(), '关联换件记录');
    expect(XLSX.utils.json_to_sheet).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ salesOrder: '404', shipment_date: '2026-08-01', matchStatus: '未匹配' })]));
  });

  it('shows repairs without a planned date separately from the rate', async () => {
    vi.mocked(doaApi.getDashboard).mockResolvedValue({
      filters: { dateFrom: '', dateTo: '', customer: '', model: '', timeGranularity: 'month' },
      summary: { shippedCount: 100, repairCount: 2, repairRate: 2, replacementCount: 0,
        replacementRate: 0, replacementRecordCount: 0, matchedRepairRecords: 1,
        excludedRepairRecords: 0, unmatchedRepairRecords: 0, missingQuantityRecords: 0,
        unmatchedPlannedRecords: 3, unmatchedPlannedQuantity: 7, latestDataAt: null },
      trend: [], byCustomer: [], byModel: [], unmatchedOrders: [],
    });
    render(<MemoryRouter><DoaPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '未匹配数据' }));
    expect(screen.getByText(/不受日期筛选，不计入当前报修率/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '查看未匹配日期明细' })).toBeTruthy();
    expect(doaApi.buildQuery).toHaveBeenCalledWith(expect.anything(), { unmatchedOnly: 'true' });
  });

  it('sorts the ranking by the selected metric and shows its order sample', async () => {
    vi.mocked(doaApi.getDashboard).mockResolvedValue({
      filters: { dateFrom: '', dateTo: '', customer: '', model: '', timeGranularity: 'month' },
      summary: {
        shippedCount: 120, repairCount: 10, repairRate: 8.33, replacementCount: 3,
        replacementRate: 2.5, replacementRecordCount: 2, matchedRepairRecords: 4,
        excludedRepairRecords: 0, unmatchedRepairRecords: 0, missingQuantityRecords: 0, unmatchedPlannedRecords: 0, unmatchedPlannedQuantity: 0, latestDataAt: null,
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
    const ranking = screen.getByText('维度排行').closest<HTMLElement>('div.border')!;
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
        excludedRepairRecords: 0, unmatchedRepairRecords: 0, missingQuantityRecords: 0, unmatchedPlannedRecords: 0, unmatchedPlannedQuantity: 0, latestDataAt: null,
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
      summary: { shippedCount: 0, repairCount: 0, repairRate: null, replacementCount: 0, replacementRate: null, replacementRecordCount: 0, matchedRepairRecords: 0, excludedRepairRecords: 0, unmatchedRepairRecords: 0, missingQuantityRecords: 0, unmatchedPlannedRecords: 0, unmatchedPlannedQuantity: 0, latestDataAt: null },
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
    expect(doaApi.getDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ dateFrom: '2026-03-01', dateTo: '2026-03-31', timeGranularity: 'day' }));
    first.unmount();

    render(<MemoryRouter initialEntries={['/doa?dateFrom=2026-03-01&dateTo=2026-03-31&timeGranularity=month']}><DoaPage /></MemoryRouter>);
    await screen.findByText('数据源不可用');
    expect(doaApi.getDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ timeGranularity: 'month' }));
  });

  it('adjusts trend granularity when the date range changes', async () => {
    vi.mocked(doaApi.getDashboard).mockRejectedValue(new Error('数据源不可用'));
    render(<MemoryRouter><DoaPage /></MemoryRouter>);
    await screen.findByText('数据源不可用');
    fireEvent.click(screen.getByRole('button', { name: '生产订单计划开始日期' }));
    fireEvent.click(screen.getByRole('button', { name: '近 30 天' }));
    await waitFor(() => expect(doaApi.getDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ timeGranularity: 'day' })));
    await screen.findByText('数据源不可用');
    expect(screen.queryByLabelText('趋势粒度')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '生产订单计划开始日期' }));
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-03-01' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-04-01' } });
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(doaApi.getDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ timeGranularity: 'month' }));
  });
});
