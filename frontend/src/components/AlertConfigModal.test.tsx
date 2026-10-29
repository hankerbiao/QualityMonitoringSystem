// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { rtyApi, type CycleDataResult } from '../api/rtyApi';
import type { RTYData } from '../types';
import AlertConfigModal from './AlertConfigModal';
import { dateRangePresets } from '../utils/dateRange';

vi.mock('../api/rtyApi', () => ({
  rtyApi: {
    getCycleData: vi.fn(),
    getCustomers: vi.fn(),
    getCycleExport: vi.fn(),
    getCycleDetails: vi.fn(),
  },
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
      orders: [{ AUFNR: '000000000001', POSNR: '000010', CPXH: 'Product A', WMENG: 99, packagingQuantity: 0 }],
      faults: [{ PCODE: 'CHILD-SN', U_FIX: 'repairer' }, { PCODE: 'CHILD-SN' }],
      modelSheets: [{
        model: 'Model A',
        rows: [{
          sequence: 1, model: 'Model A', material: 'PN*2', materialCount: 2,
          materialUsage: 20, serialCount: 1, productionQuantity: 10,
        }],
      }],
    });
    vi.mocked(rtyApi.getCycleDetails).mockResolvedValue({
      orders: [{ VBELN: 'SO-1', AUFNR: 'PO-1', WMENG: 10 }],
      faults: [{
        matchedModel: 'Model A', countedSN: 'HEAD-SN', PCODE: 'CHILD-SN',
        ZNGWD3: '原故障现象', ZWXWD3: '维修维度3内容',
      }],
    });
  });
  afterEach(cleanup);

  it('renders the order type list outside the clipped statistics panel', async () => {
    const view = render(<AlertConfigModal embedded selectedOrderTypes={['PP01']} orderTypes={['PP01', 'G001']} onOrderTypesChange={vi.fn()} />);
    await screen.findByRole('row', { name: /Model A/ });
    fireEvent.click(screen.getByRole('button', { name: '订单类型 (1)' }));
    const choice = screen.getByRole('checkbox', { name: 'G001' });
    expect(view.container.contains(choice)).toBe(false);
    expect(choice.closest('[role="dialog"]')?.parentElement).toBe(document.body);
    fireEvent.mouseDown(choice);
    expect(screen.getByRole('checkbox', { name: 'G001' })).toBeTruthy();
  });

  it('filters cycle queries, details and exports by the selected order type', async () => {
    const changeOrderType = vi.fn();
    render(<AlertConfigModal embedded selectedOrderTypes={['PP01']} orderTypes={['PP01', 'G001']} onOrderTypesChange={changeOrderType} />);
    await screen.findByRole('row', { name: /Model A/ });
    expect(screen.getByRole('button', { name: '订单类型 (1)' })).toBeTruthy();
    expect(rtyApi.getCycleData).toHaveBeenCalledWith('normal', [], expect.objectContaining({ orderTypes: ['PP01'] }));
    const modelRow = screen.getByRole('row', { name: /Model A/ });
    fireEvent.click(within(modelRow).getAllByRole('cell')[1].querySelector('button')!);
    await waitFor(() => expect(rtyApi.getCycleDetails).toHaveBeenCalledWith(expect.objectContaining({ orderTypes: ['PP01'] })));
    fireEvent.click(screen.getByRole('button', { name: '关闭明细' }));
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    await waitFor(() => expect(rtyApi.getCycleExport).toHaveBeenCalledWith(expect.objectContaining({ orderTypes: ['PP01'] })));
    fireEvent.click(screen.getByRole('button', { name: '订单类型 (1)' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'G001' }));
    expect(changeOrderType).toHaveBeenCalledWith(['PP01', 'G001']);
  });

  it('offers station-style date shortcuts and applies a selected shortcut', async () => {
    render(<AlertConfigModal embedded />);
    await screen.findByRole('row', { name: /Model A/ });
    fireEvent.click(screen.getByRole('button', { name: /近6个月/ }));
    const dialog = screen.getByRole('dialog', { name: '选择统计日期' });
    for (const { label } of dateRangePresets()) {
      expect(within(dialog).getByRole('button', { name: label })).toBeTruthy();
    }
    const preset = dateRangePresets().find(item => item.label === '上月')!;
    fireEvent.click(within(dialog).getByRole('button', { name: '上月' }));
    await waitFor(() => expect(rtyApi.getCycleData).toHaveBeenCalledWith('normal', [], expect.objectContaining({
      dateFrom: preset.from, dateTo: preset.to,
    })));
  });

  it('uses the month shortcut to prepare a full month before applying', async () => {
    render(<AlertConfigModal embedded />);
    await screen.findByRole('row', { name: /Model A/ });
    fireEvent.click(screen.getByRole('button', { name: /近6个月/ }));
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2024-01-01' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2024-01-31' } });
    fireEvent.click(screen.getByRole('button', { name: '展开月份快捷筛选' }));
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect((screen.getByLabelText('开始日期') as HTMLInputElement).value).toBe('2024-02-01');
    expect((screen.getByLabelText('结束日期') as HTMLInputElement).value).toBe('2024-02-29');
    fireEvent.click(screen.getByRole('button', { name: '应用日期' }));
    await waitFor(() => expect(rtyApi.getCycleData).toHaveBeenCalledWith('normal', [], expect.objectContaining({
      dateFrom: '2024-02-01', dateTo: '2024-02-29', forceRefresh: true,
    })));
  });

  it('searches with the current date draft and selected filters', async () => {
    vi.mocked(rtyApi.getCustomers).mockResolvedValue(['Customer 1']);
    vi.mocked(rtyApi.getCycleData).mockResolvedValue({
      ...result, data: [row, { ...row, productModel: 'Model B', base: 'D' }],
    });
    render(<AlertConfigModal embedded />);
    await screen.findByRole('row', { name: /Model A/ });
    fireEvent.click(screen.getByRole('button', { name: '选择机型' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Model A' }));
    fireEvent.click(screen.getByRole('button', { name: '选择基地' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'B' }));
    fireEvent.click(screen.getByRole('button', { name: '选择客户' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Customer 1' }));
    await waitFor(() => expect(rtyApi.getCycleData).toHaveBeenCalledWith('normal', ['Customer 1'], expect.anything()));
    fireEvent.click(screen.getByRole('button', { name: /近6个月/ }));
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-09-30' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await waitFor(() => expect(rtyApi.getCycleData).toHaveBeenCalledWith('normal', ['Customer 1'], {
      dateFrom: '2026-09-01', dateTo: '2026-09-30', forceRefresh: true,
    }));
    expect(screen.queryByRole('row', { name: /Model B/ })).toBeNull();
    expect(screen.getByRole('row', { name: /Model A/ })).toBeTruthy();
  });

  it('searches again when applying an unchanged custom date range', async () => {
    render(<AlertConfigModal embedded />);
    await screen.findByRole('row', { name: /Model A/ });
    fireEvent.click(screen.getByRole('button', { name: /近6个月/ }));
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-09-30' } });
    fireEvent.click(screen.getByRole('button', { name: '应用日期' }));
    await waitFor(() => expect(rtyApi.getCycleData).toHaveBeenCalledWith('normal', [], {
      dateFrom: '2026-09-01', dateTo: '2026-09-30', forceRefresh: true,
    }));
    vi.mocked(rtyApi.getCycleData).mockClear();
    fireEvent.click(screen.getByRole('button', { name: /自定义日期/ }));
    fireEvent.click(screen.getByRole('button', { name: '应用日期' }));
    await waitFor(() => expect(rtyApi.getCycleData).toHaveBeenCalledWith('normal', [], {
      dateFrom: '2026-09-01', dateTo: '2026-09-30', forceRefresh: true,
    }));
  });

  it('keeps the date dialog outside the clipped statistics container and applies dates', async () => {
    const view = render(<AlertConfigModal embedded />);
    await screen.findByRole('row', { name: /Model A/ });
    fireEvent.click(screen.getByRole('button', { name: /近6个月/ }));
    const dialog = screen.getByRole('dialog', { name: '选择统计日期' });
    expect(view.container.contains(dialog)).toBe(false);
    expect(dialog.parentElement).toBe(document.body);
    fireEvent.mouseDown(within(dialog).getByLabelText('开始日期'));
    fireEvent.change(within(dialog).getByLabelText('开始日期'), { target: { value: '2026-09-01' } });
    fireEvent.change(within(dialog).getByLabelText('结束日期'), { target: { value: '2026-09-30' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '应用日期' }));
    expect(screen.queryByRole('dialog', { name: '选择统计日期' })).toBeNull();
    expect(screen.getByRole('button', { name: /2026-09-01 至 2026-09-30/ })).toBeTruthy();
  });

  it('positions the date dialog within a short viewport and updates on resize', async () => {
    vi.stubGlobal('innerHeight', 300);
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(284);
    try {
      render(<AlertConfigModal embedded />);
      await screen.findByRole('row', { name: /Model A/ });
      const trigger = screen.getByRole('button', { name: /近6个月/ });
      vi.spyOn(trigger.parentElement!, 'getBoundingClientRect').mockReturnValue({
        right: 500, bottom: 270,
      } as DOMRect);
      fireEvent.click(trigger);
      const dialog = screen.getByRole('dialog', { name: '选择统计日期' });
      expect(dialog.style.top).toBe('8px');
      expect(dialog.className).toContain('overflow-y-auto');
      vi.stubGlobal('innerHeight', 600);
      fireEvent(window, new Event('resize'));
      expect(dialog.style.top).toBe('276px');
    } finally {
      height.mockRestore();
      vi.unstubAllGlobals();
    }
  });

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

  it('places order controls immediately after the order summary toggle', async () => {
    const onOrderScopeChange = vi.fn();
    const onExcludedOrdersOpen = vi.fn();
    render(
      <AlertConfigModal
        embedded
        onOrderScopeChange={onOrderScopeChange}
        onExcludedOrdersOpen={onExcludedOrdersOpen}
      />,
    );
    await screen.findByRole('row', { name: /Model A/ });

    const summaryToggle = screen.getByRole('checkbox', { name: '显示订单汇总' });
    const normalOrders = screen.getByRole('button', { name: '普通订单' });
    const excludedOrders = screen.getByRole('button', { name: '筛选订单' });
    expect(summaryToggle.compareDocumentPosition(normalOrders) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'L6 订单' }));
    fireEvent.click(excludedOrders);
    expect(onOrderScopeChange).toHaveBeenCalledWith('l6');
    expect(onExcludedOrdersOpen).toHaveBeenCalledOnce();
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

  it('selects every cycle filter option without dropping existing choices or search-hidden options', async () => {
    vi.mocked(rtyApi.getCycleData).mockResolvedValue({
      ...result,
      data: [
        { ...row, productModel: 'Model A' },
        { ...row, productModel: 'Model B' },
      ],
    });
    render(<AlertConfigModal embedded />);
    await screen.findByRole('row', { name: /Model A/ });

    fireEvent.click(screen.getByRole('button', { name: '选择机型' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Model A' }));
    fireEvent.change(screen.getByPlaceholderText('搜索机型…'), { target: { value: 'Model B' } });
    fireEvent.click(screen.getByRole('button', { name: '全选' }));

    const search = screen.getByPlaceholderText('搜索机型…') as HTMLInputElement;
    fireEvent.change(search, { target: { value: '' } });
    expect((screen.getByRole('checkbox', { name: 'Model A' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Model B' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('button', { name: '机型 (2)' })).toBeTruthy();
  });

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
    expect(workbook.SheetNames).toEqual(['趋势汇总', '销售订单', '维修故障明细记录', 'Model A']);
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
    expect(workbook.Sheets['销售订单'].J1.v).toBe('包装数量');
    expect(workbook.Sheets['销售订单'].R1.v).toBe('最终用户');
    expect(workbook.Sheets['维修故障明细记录'].AH1.v).toBe('RMA复判结论');
    expect(workbook.Sheets['维修故障明细记录'].AI1.v).toBe('订单类型');
    expect(workbook.Sheets['维修故障明细记录'].E2.v).toBe('CHILD-SN');
    expect(workbook.Sheets['维修故障明细记录'].E3.v).toBe('CHILD-SN');
  });

  it('opens a month cell with the clipped range and exports its selected detail tab', async () => {
    render(<AlertConfigModal embedded />);
    await screen.findByRole('row', { name: /Model A/ });

    fireEvent.click(screen.getByRole('button', { name: /近6个月/ }));
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-09-10' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-10-15' } });
    fireEvent.click(screen.getByRole('button', { name: '应用日期' }));
    await screen.findByRole('row', { name: /Model A/ });

    const modelRow = screen.getByRole('row', { name: /Model A/ });
    fireEvent.click(within(modelRow).getAllByRole('cell')[1].querySelector('button')!);

    expect(await screen.findByRole('heading', { name: 'Model A · 2026-09' })).toBeTruthy();
    expect(rtyApi.getCycleDetails).toHaveBeenCalledWith({
      dateFrom: '2026-09-10',
      dateTo: '2026-09-30',
      orderScope: 'normal',
      productModels: ['Model A'],
      bases: undefined,
      customers: undefined,
    });
    expect(screen.getByText('SO-1')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /维修记录/ }));
    expect(screen.getByText('CHILD-SN')).toBeTruthy();
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.queryByRole('columnheader', { name: '计入故障SN' })).toBeNull();
    const headers = dialog.getAllByRole('columnheader').map(header => header.textContent);
    const faultIndex = headers.indexOf('故障现象');
    const repairIndex = headers.indexOf('维修措施');
    expect(faultIndex).toBeGreaterThanOrEqual(0);
    expect(repairIndex).toBeGreaterThanOrEqual(0);
    const repairCells = within(dialog.getByRole('row', { name: /CHILD-SN/ })).getAllByRole('cell');
    expect(repairCells[faultIndex].textContent).toBe('原故障现象');
    expect(repairCells[repairIndex].textContent).toBe('维修维度3内容');
    fireEvent.click(screen.getByRole('button', { name: '导出维修记录' }));
    await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalledOnce());
    const workbook = vi.mocked(XLSX.writeFile).mock.calls[0][0];
    expect(workbook.SheetNames).toEqual(['维修明细']);
    const exported = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['维修明细'], { header: 1 });
    expect(exported[0]).toEqual(headers);
    expect(exported[1][1]).toBe('CHILD-SN');
    expect(exported[1][faultIndex]).toBe('原故障现象');
    expect(exported[1][repairIndex]).toBe('维修维度3内容');
  });

  it('filters and exports multiple customers including records without a customer ID', async () => {
    vi.mocked(rtyApi.getCustomers).mockResolvedValue(['Customer 1', 'Customer 2']);
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
    fireEvent.click(screen.getByRole('checkbox', { name: 'Customer 1' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Customer 2' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '无客户ID' }));
    await waitFor(() => expect(rtyApi.getCycleData).toHaveBeenLastCalledWith(
      'l6',
      ['Customer 1', 'Customer 2', '__NO_CUSTOMER_ID__'],
      expect.objectContaining({ dateFrom: '2026-09-01', dateTo: '2026-09-30' }),
    ));
    await waitFor(() => expect((screen.getByRole('button', { name: '导出' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '导出' }));

    await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalledTimes(1));
    expect(rtyApi.getCycleExport).toHaveBeenCalledExactlyOnceWith({
      dateFrom: '2026-09-01', dateTo: '2026-09-30',
      orderScope: 'l6', customers: ['Customer 1', 'Customer 2', '__NO_CUSTOMER_ID__'],
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
    expect(workbook.Sheets['维修故障明细记录']['!ref']).toBe('A1:AI1');
  });
});
