// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { rtyApi, type CycleDataResult } from '../api/rtyApi';
import type { RTYData } from '../types';
import AlertConfigModal from './AlertConfigModal';

vi.mock('../api/rtyApi', () => ({
  rtyApi: { getCycleData: vi.fn(), getCustomers: vi.fn(), getDefectDetails: vi.fn() },
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
    vi.mocked(rtyApi.getDefectDetails).mockResolvedValue([]);
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

  it('reports export failures and allows retry using actual repair SNs', async () => {
    vi.mocked(rtyApi.getDefectDetails).mockRejectedValueOnce(new Error('维修数据查询失败'));
    render(<AlertConfigModal embedded />);
    await screen.findByRole('row', { name: /Model A/ });
    fireEvent.click(screen.getByRole('button', { name: '导出' }));

    expect((await screen.findByRole('alert')).textContent).toContain('维修数据查询失败');
    expect(XLSX.writeFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalledTimes(1));
    expect(rtyApi.getDefectDetails).toHaveBeenLastCalledWith(['CHILD-SN']);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
