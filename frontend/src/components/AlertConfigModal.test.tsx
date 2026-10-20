// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
      modelSheets: [{
        model: 'Model A',
        rows: [{
          sequence: 1, model: 'Model A', material: 'PN*2', materialCount: 2,
          materialUsage: 20, serialCount: 1, productionQuantity: 10,
        }],
      }],
    });
  });
  afterEach(cleanup);

  it.each([
    { name: 'configured target', target: 92, sourceTarget: 100, input: 360, defects: 8, rate: '97.78%', color: 'text-green-700' },
    { name: 'exact target', target: 92, sourceTarget: 100, input: 400, defects: 32, rate: '92.00%', color: 'text-green-700' },
    { name: 'below target', target: 92, sourceTarget: 85, input: 400, defects: 33, rate: '91.75%', color: 'text-red-600' },
    { name: 'server target', target: undefined, sourceTarget: 92, input: 360, defects: 8, rate: '97.78%', color: 'text-green-700' },
    { name: 'zero target', target: 0, sourceTarget: 100, input: 360, defects: 360, rate: '0.00%', color: 'text-green-700' },
    { name: 'no production', target: 92, sourceTarget: 92, input: 0, defects: 0, rate: '-', color: 'text-slate-400' },
  ])('colors production totals using the $name', async ({ target, sourceTarget, input, defects, rate, color }) => {
    vi.mocked(rtyApi.getCycleData).mockResolvedValue({
      ...result,
      data: [{ ...row, productModel: '3210 C3', inputCount: input, defectCount: defects, targetRate: sourceTarget }],
    });
    render(<AlertConfigModal embedded modelTargets={target === undefined ? {} : { '3210 C3': target }} />);
    const modelRow = await screen.findByRole('row', { name: /3210 C3/ });
    const total = within(modelRow).getAllByRole('cell').at(-1)!;
    expect(within(total).getByText(rate)).toBeTruthy();
    expect(total.className).toContain(color);
  });

  it('updates total colors when model targets change without reloading cycle data', async () => {
    vi.mocked(rtyApi.getCycleData).mockResolvedValue({
      ...result,
      data: [{ ...row, productModel: '3210 C3', inputCount: 360, defectCount: 8 }],
    });
    const view = render(<AlertConfigModal embedded modelTargets={{ '3210 C3': 92 }} />);
    const modelRow = await screen.findByRole('row', { name: /3210 C3/ });
    expect(within(modelRow).getAllByRole('cell').at(-1)!.className).toContain('text-green-700');
    view.rerender(<AlertConfigModal embedded modelTargets={{ '3210 C3': 99 }} />);
    expect(within(modelRow).getAllByRole('cell').at(-1)!.className).toContain('text-red-600');
  });

  it.each(['normal', 'l6'] as const)(
    'applies model and base filters to both summaries and the %s overview',
    async orderScope => {
      vi.mocked(rtyApi.getCycleData).mockImplementation(async scope => ({
        ...result,
        data: scope === 'normal'
          ? [
            row,
            { ...row, productModel: 'Model B', inputCount: 30, defectCount: 6 },
            { ...row, base: 'D', inputCount: 90, defectCount: 9 },
          ]
          : [
            { ...row, inputCount: 5, defectCount: 1 },
            { ...row, productModel: 'Model B', inputCount: 15, defectCount: 3 },
            { ...row, base: 'D', inputCount: 95, defectCount: 19 },
          ],
      }));
      render(<AlertConfigModal embedded orderScope={orderScope} />);
      await screen.findByRole('row', { name: /Model A/ });

      fireEvent.click(screen.getByRole('button', { name: '选择机型' }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Model A' }));
      expect(within(screen.getByRole('row', { name: /普通订单汇总/ })).getByText('10/100')).toBeTruthy();
      expect(within(screen.getByRole('row', { name: /L6 订单汇总/ })).getByText('20/100')).toBeTruthy();
      expect(screen.queryByRole('row', { name: /Model B/ })).toBeNull();
      expect(screen.getByText('周期内累计投入').parentElement?.textContent).toContain('100');

      fireEvent.mouseDown(document.body);
      fireEvent.click(screen.getByRole('button', { name: '选择基地' }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'B' }));
      const normal = within(screen.getByRole('row', { name: /普通订单汇总/ }));
      const l6 = within(screen.getByRole('row', { name: /L6 订单汇总/ }));
      expect(normal.getByText('1/10')).toBeTruthy();
      expect(normal.getByText('10 台')).toBeTruthy();
      expect(l6.getByText('1/5')).toBeTruthy();
      expect(l6.getByText('5 台')).toBeTruthy();
      expect(screen.getByText('周期内累计投入').parentElement?.textContent)
        .toContain(orderScope === 'normal' ? '10' : '5');
      expect(screen.getByText('周期内总故障数').parentElement?.textContent).toContain('1');
      expect(screen.getByText('综合平均直通率').parentElement?.textContent)
        .toContain(orderScope === 'normal' ? '90.00%' : '80.00%');

      fireEvent.mouseDown(document.body);
      fireEvent.click(screen.getByRole('button', { name: '机型 (1)' }));
      fireEvent.click(screen.getByRole('button', { name: '清空' }));
      expect(normal.getByText('7/40')).toBeTruthy();
      expect(l6.getByText('4/20')).toBeTruthy();
      expect(screen.getByRole('row', { name: /Model B/ })).toBeTruthy();
      expect(screen.getByText('周期内累计投入').parentElement?.textContent)
        .toContain(orderScope === 'normal' ? '40' : '20');
    },
  );

  it('shows an empty L6 summary when the selected model has no L6 orders', async () => {
    vi.mocked(rtyApi.getCycleData).mockImplementation(async scope => ({
      ...result,
      data: scope === 'normal'
        ? [row, { ...row, productModel: 'Model B' }]
        : [{ ...row, productModel: 'Model B' }],
    }));
    render(<AlertConfigModal embedded />);
    await screen.findByRole('row', { name: /Model A/ });
    fireEvent.click(screen.getByRole('button', { name: '选择机型' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Model A' }));

    expect(within(screen.getByRole('row', { name: /普通订单汇总/ })).getByText('1/10')).toBeTruthy();
    const l6 = within(screen.getByRole('row', { name: /L6 订单汇总/ }));
    expect(l6.queryByText('10 台')).toBeNull();
    expect(l6.getAllByText('-')).toHaveLength(2);
  });

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
    expect(workbook.SheetNames).toEqual(['趋势汇总', '销售订单', '维修故障明记录', 'Model A']);
    expect(workbook.Sheets['Model A'].E2.v).toBe('PN*2');
    expect(workbook.Sheets['Model A'].I2.f).toBe('G2/H2');
    expect(XLSX.utils.sheet_to_json(workbook.Sheets['趋势汇总'])).toEqual([{
      月份: '2026-09', 机型: 'Model A', 产量: 10, 故障数: 1,
      直通率: '90.000%', 目标直通率: '95.000%', 状态: '未达标',
    }]);
    expect(workbook.Sheets['销售订单'].B2).toMatchObject({ t: 's', v: '000010' });
    expect(workbook.Sheets['销售订单'].C2.v).toBe('000000000001');
    expect(workbook.Sheets['销售订单'].E2.v).toBe('Product A');
    expect(workbook.Sheets['销售订单'].J2).toMatchObject({ t: 'n', v: 0 });
    expect(workbook.Sheets['销售订单'].R1.v).toBe('最终用户');
    expect(workbook.Sheets['维修故障明记录'].AI1.v).toBe('RMA复判结论');
    expect(workbook.Sheets['维修故障明记录'].AJ1.v).toBe('订单类型');
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
    expect(workbook.Sheets['维修故障明记录']['!ref']).toBe('A1:AJ1');
  });
});
