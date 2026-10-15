// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { rtyApi, type CycleDataResult } from '../api/rtyApi';
import type { RTYData } from '../types';
import AlertConfigModal from './AlertConfigModal';

vi.mock('../api/rtyApi', () => ({
  rtyApi: { getCycleData: vi.fn(), getCustomers: vi.fn(), getCycleExport: vi.fn() },
}));
vi.mock('../context/SettingsContext', () => ({
  useSettings: () => ({ settings: { cycleStatsConfig: { selectedModels: [] } }, updateSettings: vi.fn() }),
}));
vi.mock('xlsx', async importOriginal => ({
  ...await importOriginal<typeof XLSX>(), writeFile: vi.fn(),
}));

const row: RTYData = {
  id: 'cycle:2026-09:A:B', time: '2026-09', model: '复合机型', productModel: 'Model A',
  base: 'B', customer: '', inputCount: 10, defectCount: 1, rtyRate: 90, targetRate: 95,
  serialNumbers: ['HEAD-SN'], faultSerialNumbers: ['CHILD-SN'],
  salesOrder: '', productionOrder: '', salesOrders: [], productionOrders: [], productLine: '', status: '',
};
const result: CycleDataResult = { data: [row], cached: false, cachedAt: 1 };

describe('cycle query and export', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(rtyApi.getCustomers).mockResolvedValue([]);
    vi.mocked(rtyApi.getCycleData).mockResolvedValue(result);
    vi.mocked(rtyApi.getCycleExport).mockResolvedValue({
      orders: [{ AUFNR: '000000000001', POSNR: '000010', CPXH: 'Product A', WMENG: 0 }],
      faults: [{ PCODE: 'CHILD-SN', U_FIX: 'repairer' }, { PCODE: 'CHILD-SN' }],
    });
  });
  afterEach(cleanup);

  it('clears old results and blocks export after a new date range fails, then retries', async () => {
    render(<AlertConfigModal embedded />);
    await screen.findByRole('row', { name: /Model A/ });
    vi.mocked(rtyApi.getCycleData).mockRejectedValue(new Error('查询超时'));

    fireEvent.click(screen.getByRole('button', { name: /近6个月/ }));
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-09-30' } });
    fireEvent.click(screen.getByRole('button', { name: '应用日期' }));

    expect((await screen.findByRole('alert')).textContent).toContain('查询超时');
    expect(screen.queryByRole('row', { name: /Model A/ })).toBeNull();
    expect((screen.getByRole('button', { name: '导出' }) as HTMLButtonElement).disabled).toBe(true);

    vi.mocked(rtyApi.getCycleData).mockResolvedValue(result);
    fireEvent.click(screen.getByRole('button', { name: '重新查询' }));
    await screen.findByRole('row', { name: /Model A/ });
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button', { name: '导出' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('ignores a response from an earlier order scope', async () => {
    let resolveOld!: (value: CycleDataResult) => void;
    const oldResponse = new Promise<CycleDataResult>(resolve => { resolveOld = resolve; });
    vi.mocked(rtyApi.getCycleData)
      .mockReturnValueOnce(oldResponse)
      .mockReturnValueOnce(oldResponse)
      .mockResolvedValue({ ...result, data: [{ ...row, productModel: 'New Model' }] });

    const view = render(<AlertConfigModal embedded orderScope="normal" />);
    view.rerender(<AlertConfigModal embedded orderScope="l6" />);
    await screen.findByRole('row', { name: /New Model/ });
    await act(async () => { resolveOld(result); });

    expect(screen.queryByRole('row', { name: /Model A/ })).toBeNull();
    expect(screen.getByRole('row', { name: /New Model/ })).toBeTruthy();
  });

  it('reports source export failures and permits a complete retry', async () => {
    vi.mocked(rtyApi.getCycleExport).mockRejectedValueOnce(new Error('维修数据查询失败'));
    render(<AlertConfigModal embedded />);
    await screen.findByRole('row', { name: /Model A/ });
    fireEvent.click(screen.getByRole('button', { name: '导出' }));

    expect((await screen.findByRole('alert')).textContent).toContain('维修数据查询失败');
    expect(XLSX.writeFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalledTimes(1));
    expect(rtyApi.getCycleExport).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('preserves the trend summary and appends both raw source sheets', async () => {
    render(<AlertConfigModal embedded />);
    await screen.findByRole('row', { name: /Model A/ });
    fireEvent.click(screen.getByRole('button', { name: '导出' }));

    await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalledTimes(1));
    const workbook = vi.mocked(XLSX.writeFile).mock.calls[0][0];
    expect(workbook.SheetNames).toEqual(['趋势汇总', '销售订单', '维修故障明记录']);
    expect(XLSX.utils.sheet_to_json(workbook.Sheets['趋势汇总'])).toEqual([{
      月份: '2026-09', 机型: 'Model A', 产量: 10, 故障数: 1,
      直通率: '90.000%', 目标直通率: '95.000%', 状态: '未达标',
    }]);
    expect(workbook.Sheets['销售订单'].B2).toMatchObject({ t: 's', v: '000010' });
    expect(workbook.Sheets['销售订单'].C2.v).toBe('000000000001');
    expect(workbook.Sheets['销售订单'].E2.v).toBe('Product A');
    expect(workbook.Sheets['销售订单'].J2).toMatchObject({ t: 'n', v: 0 });
    expect(workbook.Sheets['销售订单'].R1.v).toBe('最终用户');
    expect(workbook.Sheets['维修故障明记录'].AH1.v).toBe('RMA复判结论');
    expect(workbook.Sheets['维修故障明记录'].E2.v).toBe('CHILD-SN');
    expect(workbook.Sheets['维修故障明记录'].E3.v).toBe('CHILD-SN');
  });

  it('exports applied dates, customer, order scope and multiple selected models and bases', async () => {
    vi.mocked(rtyApi.getCustomers).mockResolvedValue(['Customer 1']);
    vi.mocked(rtyApi.getCycleData).mockResolvedValue({
      ...result,
      data: [
        row,
        { ...row, productModel: 'Model B', base: 'D' },
        { ...row, productModel: 'Model C', base: 'E' },
      ],
    });
    render(<AlertConfigModal embedded orderScope="l6" />);
    await screen.findByRole('row', { name: /Model A/ });
    fireEvent.click(screen.getByRole('button', { name: /近6个月/ }));
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-09-30' } });
    fireEvent.click(screen.getByRole('button', { name: '应用日期' }));
    await waitFor(() => expect((screen.getByRole('button', { name: '导出' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '选择机型' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Model A' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Model B' }));
    fireEvent.click(screen.getByRole('button', { name: '选择基地' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'B' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'D' }));
    fireEvent.click(screen.getByRole('button', { name: '选择客户' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Customer 1' }));
    await waitFor(() => expect((screen.getByRole('button', { name: '导出' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '导出' }));

    await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalledTimes(1));
    expect(rtyApi.getCycleExport).toHaveBeenCalledExactlyOnceWith({
      dateFrom: '2026-09-01', dateTo: '2026-09-30',
      orderScope: 'l6', customer: 'Customer 1',
      productModels: ['Model A', 'Model B'], bases: ['B', 'D'],
    });
  });

  it('blocks duplicate exports while source records are loading', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof rtyApi.getCycleExport>>) => void;
    vi.mocked(rtyApi.getCycleExport).mockReturnValue(new Promise(done => { resolve = done; }));
    render(<AlertConfigModal embedded />);
    await screen.findByRole('row', { name: /Model A/ });
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    const button = screen.getByRole('button', { name: '导出中...' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(rtyApi.getCycleExport).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ orders: [], faults: [] }); });
    await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalledTimes(1));
    const workbook = vi.mocked(XLSX.writeFile).mock.calls[0][0];
    expect(workbook.Sheets['销售订单']['!ref']).toBe('A1:R1');
    expect(workbook.Sheets['维修故障明记录']['!ref']).toBe('A1:AH1');
  });
});
