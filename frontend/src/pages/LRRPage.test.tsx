// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { lrrApi } from '../api/lrrApi';
import LRRPage, { DetailModal } from './LRRPage';

const xlsx = vi.hoisted(() => ({
  aoa_to_sheet: vi.fn((rows: unknown) => rows), book_new: vi.fn(() => ({})),
  book_append_sheet: vi.fn(), writeFile: vi.fn(),
}));
vi.mock('xlsx', () => ({ utils: xlsx, writeFile: xlsx.writeFile }));

vi.mock('../api/lrrApi', () => ({
  clearLrrApiCache: vi.fn(),
  lrrApi: { getOptions: vi.fn(), getLRRData: vi.fn(), getFaultDetails: vi.fn(), getAllLRRData: vi.fn() },
}));
vi.mock('../components/shared/DashboardSwitcher', () => ({ DashboardSwitcher: () => null }));
vi.mock('../components/shared/HelpTooltip', () => ({ HelpTooltip: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock('../components/ui', () => ({ LoadingSpinner: () => <span /> }));
vi.mock('recharts', () => ({
  Bar: () => null, CartesianGrid: () => null, ComposedChart: () => null,
  Line: () => null, ResponsiveContainer: () => null, Tooltip: () => null,
  XAxis: () => null, YAxis: () => null,
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('shows an empty overview before the first query without loading dashboard data', async () => {
  vi.mocked(lrrApi.getOptions).mockResolvedValue({ materialNumbers: [], productModels: [], bases: [], customerIds: [] });
  render(<MemoryRouter><LRRPage /></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: '物料质量概览' })).toBeTruthy();
  expect(screen.getAllByText('待查询').length).toBeGreaterThan(0);
  expect(lrrApi.getLRRData).not.toHaveBeenCalled();
});

it('sorts the filtered material results across pages and preserves draft filters', async () => {
  vi.mocked(lrrApi.getOptions).mockResolvedValue({ materialNumbers: [], productModels: [], bases: [], customerIds: [] });
  vi.mocked(lrrApi.getLRRData).mockImplementation(async (page = 1, limit = 50) => ({
    items: [], total: 51, page, limit, has_more: page === 1,
    summary: { materialCount: 51, issuedQuantity: 0, totalFaults: 0, overallLrr: 0 },
  }));
  render(<MemoryRouter><LRRPage /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: '本月' }));
  const table = within(await screen.findByRole('region', { name: '物料 PN 明细表' }));
  const originalFilters = vi.mocked(lrrApi.getLRRData).mock.calls[0][2];
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  await waitFor(() => expect(screen.getByText(/第 2 \/ 2 页/)).toBeTruthy());

  const material = screen.getByRole<HTMLInputElement>('searchbox', { name: '物料号' });
  fireEvent.change(material, { target: { value: '12345678' } });

  for (const [label, sortBy, sortDir, ariaSort] of [
    ['故障总数', 'faultCount', 'desc', 'descending'],
    ['故障总数', 'faultCount', 'asc', 'ascending'],
    ['故障率', 'lrrRate', 'desc', 'descending'],
    ['故障率', 'lrrRate', 'asc', 'ascending'],
  ]) {
    fireEvent.click(table.getByRole('button', { name: label }));
    expect(lrrApi.getLRRData).toHaveBeenLastCalledWith(
      1, 50, { ...originalFilters, sortBy, sortDir }, expect.any(AbortSignal),
    );
    await waitFor(() => expect(table.getByRole('columnheader', { name: label }).getAttribute('aria-sort')).toBe(ariaSort));
    expect(material.value).toBe('12345678');
  }

  fireEvent.click(screen.getByRole('button', { name: '查询' }));
  expect(lrrApi.getLRRData).toHaveBeenLastCalledWith(
    1, 50, { ...originalFilters, materialNumber: '12345678', sortBy: 'lrrRate', sortDir: 'asc' }, expect.any(AbortSignal),
  );
  await waitFor(() => expect(screen.getByText(/第 1 \/ 2 页/)).toBeTruthy());
});

it('shows additional repair fields and preserves the full LRR export', () => {
  const item = { month: '2026-10', materialNumber: 'PN1', materialDescription: '部件', sn: 'SN1',
    faultType: '', faultDesc: '', ngTime: '', matchedModel: 'M1', salesOrder: 'SO1',
    productionOrder: 'PO1', faultPhenomenon: '故障现象内容', repairAction: '更换部件',
    station: 'OP210', repairPerson: '维修员', repairTime: '20261029091214',
    raw: { FACTORY: '基地A', ZNGWD2: '维度2内容', MATNR: '000123', MAKTX: '原始物料描述', ERROR_CODE: 'E01', FIX_REMARKS: '维修备注内容' } };
  render(<DetailModal title="PN1 故障明细" items={[item]} loading={false} error={null} onClose={() => {}} />);
  const dialog = screen.getByRole('dialog', { name: 'PN1 故障明细' });
  expect(within(dialog).getByText('计入机型')).toBeTruthy();
  expect(within(dialog).getByText('故障现象内容')).toBeTruthy();
  for (const value of Object.values(item.raw)) {
    expect(within(dialog).getByRole('cell', { name: value })).toBeTruthy();
  }
  expect(within(dialog).getByText('共 1 条记录')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: '导出维修 SN' }));
  const [headers, values] = xlsx.aoa_to_sheet.mock.calls[0][0] as unknown[][];
  expect(values[headers.indexOf('维修人员备注维修信息')]).toBe('维修备注内容');
  expect(values[headers.indexOf('LRR完整物料PN')]).toBe('PN1');
  expect(xlsx.writeFile).toHaveBeenCalled();
});
