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
