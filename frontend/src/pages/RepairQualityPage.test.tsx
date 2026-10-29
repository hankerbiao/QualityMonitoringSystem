// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { rtyApi } from '../api/rtyApi';
import RepairQualityPage from './RepairQualityPage';

vi.mock('../api/rtyApi', () => ({ rtyApi: { getRepairQualityOptions: vi.fn(), getRepairQuality: vi.fn(), getRepairQualityExport: vi.fn() } }));
vi.mock('xlsx', async importOriginal => ({ ...await importOriginal<typeof import('xlsx')>(), writeFile: vi.fn() }));
vi.mock('../components/shared/DashboardSwitcher', () => ({ DashboardSwitcher: () => null }));

const summary = {
  snCount: 3,
  firstPassCount: 2,
  repeatCount: 1,
  firstPassRate: 66.67,
  distribution: [
    { repairCount: '1', snCount: 2, percentage: 66.67 },
    { repairCount: '2', snCount: 1, percentage: 33.33 },
    ...Array.from({ length: 7 }, (_, index) => ({ repairCount: String(index + 3), snCount: 0, percentage: 0 })),
    { repairCount: '9+', snCount: 0, percentage: 0 },
  ],
  groups: [{
    customer: 'C-1', base: '天津', snCount: 3, firstPassCount: 2, repeatCount: 1,
    firstPassRate: 66.67,
    distribution: [
      { repairCount: '1', snCount: 2, percentage: 66.67 },
      { repairCount: '2', snCount: 1, percentage: 33.33 },
      ...Array.from({ length: 7 }, (_, index) => ({ repairCount: String(index + 3), snCount: 0, percentage: 0 })),
      { repairCount: '9+', snCount: 0, percentage: 0 },
    ],
  }],
};

describe('RepairQualityPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(rtyApi.getRepairQualityOptions).mockResolvedValue({
      productModels: ['M-1'], customers: ['C-1'], bases: ['1000'],
    });
    vi.mocked(rtyApi.getRepairQuality).mockResolvedValue(summary);
    vi.mocked(rtyApi.getRepairQualityExport).mockResolvedValue({ summary, orders: [], faults: [] });
  });
  afterEach(cleanup);

  it('applies multiline advanced filters', async () => {
    render(<MemoryRouter><RepairQualityPage /></MemoryRouter>);
    await waitFor(() => expect(rtyApi.getRepairQuality).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '高级筛选' }));
    fireEvent.change(screen.getByLabelText('SN'), { target: { value: 'SN1\nSN2' } });
    fireEvent.change(screen.getByLabelText('生产订单'), { target: { value: '1\n2' } });
    fireEvent.change(screen.getByLabelText('销售订单'), { target: { value: 'S1\nS2' } });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    await waitFor(() => expect(rtyApi.getRepairQuality).toHaveBeenLastCalledWith(expect.objectContaining({ serialNumbers: ['SN1', 'SN2'], productionOrders: ['1', '2'], salesOrders: ['S1', 'S2'] })));
  });

  it('queries with date and chosen dimensions and renders KPIs and grouped results', async () => {
    render(<MemoryRouter><RepairQualityPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: '维修通过率分析' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '返回首页' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: '客户（多选）' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'C-1' }));
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    await waitFor(() => expect(rtyApi.getRepairQuality).toHaveBeenCalledWith(expect.objectContaining({ customers: ['C-1'] })));
    expect((await screen.findAllByText('66.67%')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('C-1').length).toBeGreaterThan(0);
    expect(screen.getByRole('img', { name: '按维修次数划分的首修与复修构成饼图' })).toBeTruthy();
    expect(screen.getByRole('img', { name: '维修次数分布数量及占比组合图' })).toBeTruthy();
    expect(screen.queryByText('累计维修次数覆盖率')).toBeNull();
    expect(screen.queryByText('客户 / 基地复修量排行')).toBeNull();
    expect(screen.queryByLabelText('订单范围')).toBeNull();
    expect(screen.queryByLabelText('海外')).toBeNull();
  });

  it('renders an empty state and exposes request failures', async () => {
    vi.mocked(rtyApi.getRepairQuality).mockResolvedValue({ ...summary, snCount: 0, groups: [] });
    render(<MemoryRouter><RepairQualityPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '查询' }));
    expect(await screen.findByText('当前筛选条件下没有维修 SN')).toBeTruthy();

    vi.mocked(rtyApi.getRepairQuality).mockRejectedValue(new Error('数据源不可用'));
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    expect((await screen.findByRole('alert')).textContent).toContain('数据源不可用');
  });

  it('resets filters and clears displayed results', async () => {
    render(<MemoryRouter><RepairQualityPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '查询' }));
    await screen.findByText('C-1');
    fireEvent.click(screen.getByRole('button', { name: '重置' }));
    expect(screen.queryByText('客户 / 基地维修表现')).toBeNull();
    expect(screen.getByRole('button', { name: '查询' })).toBeTruthy();
  });

  it('exports the last successful query, not unsubmitted filters, and resets export availability', async () => {
    render(<MemoryRouter><RepairQualityPage /></MemoryRouter>);
    await screen.findByText('客户 / 基地维修表现');
    const applied = vi.mocked(rtyApi.getRepairQuality).mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: '实际开始日期（订单）' }));
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2025-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    fireEvent.click(screen.getByRole('button', { name: '客户（多选）' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'C-1' }));
    fireEvent.click(screen.getByRole('button', { name: /导出维修通过率分析表/ }));
    await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalledOnce());
    expect(rtyApi.getRepairQualityExport).toHaveBeenCalledWith(applied);
    const [workbook, filename] = vi.mocked(XLSX.writeFile).mock.calls[0];
    expect(workbook.SheetNames).toEqual(['维修通过率分析表', '销售订单', '维修故障明细记录']);
    expect(filename).toBe(`维修通过率分析_${applied.dateFrom}_${applied.dateTo}.xlsx`);
    fireEvent.click(screen.getByRole('button', { name: '重置' }));
    expect((screen.getByRole('button', { name: /导出维修通过率分析表/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables export until data exists and during download, handles errors and allows retry', async () => {
    let rejectExport!: (reason: Error) => void;
    vi.mocked(rtyApi.getRepairQualityExport).mockImplementationOnce(() => new Promise((_, reject) => { rejectExport = reject; }));
    render(<MemoryRouter><RepairQualityPage /></MemoryRouter>);
    const button = screen.getByRole('button', { name: /导出维修通过率分析表/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await screen.findByText('客户 / 基地维修表现');
    fireEvent.click(button);
    expect(button.disabled).toBe(true);
    rejectExport(new Error('数据源不可用'));
    expect((await screen.findByRole('alert')).textContent).toContain('数据源不可用');
    expect(XLSX.writeFile).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalledOnce());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('queries the selected shortcut and resets the unified control to its initial range', async () => {
    render(<MemoryRouter><RepairQualityPage /></MemoryRouter>);
    await screen.findByText('客户 / 基地维修表现');
    const initial = vi.mocked(rtyApi.getRepairQuality).mock.calls[0][0];
    const trigger = screen.getByRole('button', { name: '实际开始日期（订单）' });
    expect(screen.queryByLabelText('开始日期')).toBeNull();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: '上月' }));
    expect(rtyApi.getRepairQuality).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    const from = `${last.getFullYear()}-${pad(last.getMonth() + 1)}-01`;
    const to = `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`;
    await waitFor(() => expect(rtyApi.getRepairQuality).toHaveBeenLastCalledWith({ dateFrom: from, dateTo: to }));
    await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '重置' }));
    expect(trigger.textContent).toContain(initial.dateFrom);
    expect(trigger.textContent).toContain(initial.dateTo);
    expect(screen.queryByText('客户 / 基地维修表现')).toBeNull();
  });
});
