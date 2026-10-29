// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { rtyApi } from '../api/rtyApi';
import type { RTYData } from '../types';
import type { RTYTemplateExport } from '../types/rty';
import RTYPage from './RTYPage';

vi.mock('../api/rtyApi', () => ({
  rtyApi: { getRTYData: vi.fn(), getFilterOptions: vi.fn(), getTemplateExport: vi.fn() },
}));
vi.mock('../context/SettingsContext', () => ({
  useSettings: () => ({ settings: { modelTargets: {} } }),
}));
vi.mock('../components/AlertConfigModal', () => ({
  default: ({ onDetailOpen }: { onDetailOpen: () => void }) => <button onClick={onDetailOpen}>详情</button>,
}));
vi.mock('../components/shared/DashboardSwitcher', () => ({ DashboardSwitcher: () => null }));
vi.mock('xlsx', async importOriginal => ({
  ...await importOriginal<typeof XLSX>(), writeFile: vi.fn(),
}));

const row: RTYData = {
  id: '1', time: '2026-09-15', model: '复合机型', productModel: 'Model A',
  base: 'B', customer: '', inputCount: 10, defectCount: 1, rtyRate: 90, targetRate: 95,
  serialNumbers: ['HEAD-SN'], faultSerialNumbers: ['CHILD-SN'],
  salesOrder: '', productionOrder: '', salesOrders: [], productionOrders: [], productLine: '', status: '',
};

const exportData: RTYTemplateExport = {
  summary: [{ model: 'Model A', completedQuantity: 10, defectCount: 1, completionRate: 0.9 }],
  orders: [{ AUFNR: '000000000001' }, { AUFNR: '000000000002' }],
  faults: [{ PCODE: 'CHILD-SN', U_FIX: 'repairer' }],
  topProblems: [],
};

async function openExport() {
  render(<MemoryRouter initialEntries={['/rty?productionOrder=1']}><RTYPage /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: '详情' }));
  fireEvent.click(screen.getByRole('button', { name: '查询' }));
  await screen.findByText('Model A');
  fireEvent.click(screen.getByRole('button', { name: '导出' }));
}

describe('RTY table export', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(rtyApi.getFilterOptions).mockResolvedValue({ productModels: [], bases: [], customers: [] });
    vi.mocked(rtyApi.getRTYData).mockResolvedValue({
      items: [row], total: 1, page: 1, limit: 50, has_more: false,
    });
    vi.mocked(rtyApi.getTemplateExport).mockResolvedValue(exportData);
  });
  afterEach(cleanup);

  it('defaults the detail query to PP01 and allows all order types', async () => {
    render(<MemoryRouter><RTYPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '详情' }));
    const selector = screen.getByRole('button', { name: '订单类型 (1)' });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    await waitFor(() => expect(rtyApi.getRTYData).toHaveBeenCalledWith(expect.objectContaining({ orderTypes: ['PP01'] }), 1, 50));
    fireEvent.click(selector);
    fireEvent.click(screen.getByRole('checkbox', { name: 'PP01' }));
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    await waitFor(() => expect(rtyApi.getRTYData).toHaveBeenLastCalledWith(expect.objectContaining({ orderTypes: [] }), 1, 50));
  });

  it('shows a failed export and permits a successful retry', async () => {
    vi.mocked(rtyApi.getTemplateExport).mockRejectedValueOnce(new Error('维修数据查询失败'));
    await openExport();

    expect((await screen.findByRole('alert')).textContent).toContain('维修数据查询失败');
    expect(XLSX.writeFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalledTimes(1));
    expect(rtyApi.getTemplateExport).toHaveBeenLastCalledWith(
      expect.objectContaining({ productionOrder: '1', orderScope: 'normal' }),
    );
  });

  it('disables duplicate export while repair details are pending', async () => {
    let resolve!: (value: RTYTemplateExport) => void;
    vi.mocked(rtyApi.getTemplateExport).mockReturnValue(new Promise(done => { resolve = done; }));
    await openExport();

    const buttons = screen.getAllByRole('button', { name: '导出中...' });
    expect(buttons.every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    buttons.forEach(button => fireEvent.click(button));
    expect(rtyApi.getTemplateExport).toHaveBeenCalledTimes(1);
    resolve(exportData);
    await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalledTimes(1));
  });

  it('exports the complete template response rather than the displayed page', async () => {
    await openExport();

    await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalledTimes(1));
    const workbook = vi.mocked(XLSX.writeFile).mock.calls[0][0];
    expect(workbook.SheetNames).toEqual([
      '直通率', '销售订单-分母', '维修故障明细记录-分子', 'TOP问题',
    ]);
    expect(workbook.Sheets['销售订单-分母'].C3.v).toBe('000000000001');
    expect(workbook.Sheets['销售订单-分母'].C4.v).toBe('000000000002');
    expect(workbook.Sheets['维修故障明细记录-分子'].E3.v).toBe('CHILD-SN');
  });
});
