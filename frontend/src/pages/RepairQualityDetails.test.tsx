// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { rtyApi } from '../api/rtyApi';
import RepairQualityPage from './RepairQualityPage';

vi.mock('../api/rtyApi', () => ({
  rtyApi: {
    getRepairQualityOptions: vi.fn().mockResolvedValue({ productModels: [], customers: ['客户A'], bases: [] }),
    getRepairQuality: vi.fn(),
    getRepairQualityDetails: vi.fn(),
    getRepairQualityExport: vi.fn(),
  },
}));
vi.mock('../components/shared/DashboardSwitcher', () => ({ DashboardSwitcher: () => null }));
vi.mock('../components/repair/RepairQualityCharts', () => ({ RepairQualityCharts: () => null }));
vi.mock('xlsx', () => ({
  utils: { book_new: vi.fn(() => ({})), json_to_sheet: vi.fn(rows => rows), book_append_sheet: vi.fn() },
  writeFile: vi.fn(),
}));

const distribution = [
  { repairCount: '1', snCount: 1, percentage: 50 },
  { repairCount: '2', snCount: 1, percentage: 50 },
  { repairCount: '9+', snCount: 0, percentage: 0 },
];
const group = { customer: '客户A', base: '1000', snCount: 2, firstPassCount: 1, repeatCount: 1, firstPassRate: 50, distribution };
const item = {
  sn: 'SN-1', productionOrders: ['P1', 'P2'], models: ['M1'], repairCount: 2,
  repairs: [{ productionOrder: 'P1', salesOrder: 'SO1', station: 'OP10', faultCode: 'E1', description: '故障描述', foundDate: '20261001', repairDate: '', repairPerson: '张三' }],
};

describe('维修明细', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('opens the selected bucket with applied filters and expands and exports records', async () => {
    vi.mocked(rtyApi.getRepairQuality).mockResolvedValue({ ...group, groups: [group] });
    vi.mocked(rtyApi.getRepairQualityDetails).mockResolvedValue({ items: [item], total: 1, page: 1, pageSize: 50 });
    render(<MemoryRouter><RepairQualityPage /></MemoryRouter>);

    const button = await screen.findByRole('button', { name: '客户A 1000 维修 2 次 数量明细' });
    fireEvent.click(screen.getByRole('button', { name: '客户（多选）' }));
    fireEvent.click(screen.getByLabelText('客户A'));
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: '维修 SN 明细' });
    await within(dialog).findByText('SN-1');
    expect(rtyApi.getRepairQualityDetails).toHaveBeenCalledWith(expect.objectContaining({
      customer: '客户A', base: '1000', bucket: '2',
    }), 1);
    expect(vi.mocked(rtyApi.getRepairQualityDetails).mock.calls[0][0].customers).toBeUndefined();
    fireEvent.click(within(dialog).getByRole('button', { name: '展开 SN-1 维修记录' }));
    expect(within(dialog).getByRole('cell', { name: '故障描述' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '导出明细' }));
    await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalled());
    expect(rtyApi.getRepairQualityDetails).toHaveBeenCalledWith(expect.objectContaining({ bucket: '2' }), 1, true);
    expect(XLSX.utils.json_to_sheet).toHaveBeenCalledWith([expect.objectContaining({ SN: 'SN-1', 故障描述: '故障描述' })]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '维修 SN 明细' })).toBeNull();
  });

  it('opens total and first-pass buckets and disables empty cells', async () => {
    vi.mocked(rtyApi.getRepairQuality).mockResolvedValue({ ...group, groups: [group] });
    vi.mocked(rtyApi.getRepairQualityDetails).mockResolvedValue({ items: [], total: 2, page: 1, pageSize: 50 });
    render(<MemoryRouter><RepairQualityPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: '客户A 1000 全部维修 SN 明细' }));
    await waitFor(() => expect(rtyApi.getRepairQualityDetails).toHaveBeenCalledWith(expect.objectContaining({ bucket: 'all' }), 1));
    fireEvent.click(screen.getByRole('button', { name: '关闭明细' }));
    fireEvent.click(screen.getByRole('button', { name: '客户A 1000 首修通过明细' }));
    await waitFor(() => expect(rtyApi.getRepairQualityDetails).toHaveBeenCalledWith(expect.objectContaining({ bucket: '1' }), 1));
    expect(screen.getByRole('button', { name: '客户A 1000 维修 9+ 次 数量明细' }).hasAttribute('disabled')).toBe(true);
  });

  it('loads the next page and surfaces detail errors with retry', async () => {
    vi.mocked(rtyApi.getRepairQuality).mockResolvedValue({ ...group, groups: [group] });
    vi.mocked(rtyApi.getRepairQualityDetails)
      .mockResolvedValueOnce({ items: [item], total: 51, page: 1, pageSize: 50 })
      .mockRejectedValueOnce(new Error('读取失败'))
      .mockResolvedValueOnce({ items: [{ ...item, sn: 'SN-2' }], total: 51, page: 2, pageSize: 50 });
    render(<MemoryRouter><RepairQualityPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '客户A 1000 全部维修 SN 明细' }));
    const dialog = screen.getByRole('dialog', { name: '维修 SN 明细' });
    await within(dialog).findByText('SN-1');
    expect(within(dialog).getByRole('alert').textContent).toContain('数据已变化');
    fireEvent.click(within(dialog).getByRole('button', { name: '下一页' }));
    await within(dialog).findByText('读取失败');
    fireEvent.click(within(dialog).getByRole('button', { name: '重试' }));
    await within(dialog).findByText('SN-2');
    expect(rtyApi.getRepairQualityDetails).toHaveBeenLastCalledWith(expect.anything(), 2);
  });
});
