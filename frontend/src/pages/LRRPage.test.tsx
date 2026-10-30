// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

it('shows and exports the same repair fields as station details', () => {
  const item = { month: '2026-10', materialNumber: 'PN1', materialDescription: '部件', sn: 'SN1',
    faultType: '', faultDesc: '', ngTime: '', matchedModel: 'M1', salesOrder: 'SO1',
    productionOrder: 'PO1', faultPhenomenon: '故障现象内容', repairAction: '更换部件',
    station: 'OP210', repairPerson: '维修员', repairTime: '20261029091214' };
  render(<DetailModal title="PN1 故障明细" items={[item]} loading={false} error={null} onClose={() => {}} />);
  const dialog = screen.getByRole('dialog', { name: 'PN1 故障明细' });
  expect(within(dialog).getByText('计入机型')).toBeTruthy();
  expect(within(dialog).getByText('故障现象内容')).toBeTruthy();
  expect(within(dialog).getByText('共 1 条记录')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: '导出维修 SN' }));
  expect(xlsx.aoa_to_sheet).toHaveBeenCalledWith([
    ['计入机型', '维修记录SN', '销售订单', '维修记录订单', '故障现象', '维修措施', '故障工站', '维修人员', '维修时间'],
    ['M1', 'SN1', 'SO1', 'PO1', '故障现象内容', '更换部件', 'OP210', '维修员', '20261029091214'],
  ]);
  expect(xlsx.writeFile).toHaveBeenCalled();
});
