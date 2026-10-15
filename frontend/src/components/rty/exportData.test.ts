import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rtyApi } from '../../api/rtyApi';
import type { RTYData } from '../../types';
import { loadFaultExportRows } from './exportData';

vi.mock('../../api/rtyApi', () => ({ rtyApi: { getDefectDetails: vi.fn() } }));

describe('loadFaultExportRows', () => {
  beforeEach(() => vi.resetAllMocks());

  it('uses actual repair SNs for composite models and deduplicates shared SNs', async () => {
    vi.mocked(rtyApi.getDefectDetails).mockResolvedValue([
      { sn: 'CHILD-SN', defectCode: 'F-1', description: 'Repair' } as never,
    ]);
    const rows = [
      { serialNumbers: ['HEAD-SN'], faultSerialNumbers: ['CHILD-SN'] },
      { serialNumbers: ['NORMAL-SN', 'CHILD-SN'] },
    ] as RTYData[];

    expect(await loadFaultExportRows(rows)).toMatchObject([
      { 机器SN: 'CHILD-SN', 故障类型: 'F-1', 故障描述: 'Repair' },
    ]);
    expect(rtyApi.getDefectDetails).toHaveBeenCalledExactlyOnceWith(['CHILD-SN', 'NORMAL-SN']);
  });

  it('bounds batch size and reports a failed batch instead of returning partial rows', async () => {
    vi.mocked(rtyApi.getDefectDetails)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('查询超时'));
    const sns = Array.from({ length: 401 }, (_, index) => `SN-${index}`);

    await expect(loadFaultExportRows([{ serialNumbers: sns } as RTYData])).rejects.toThrow('查询超时');
    expect(rtyApi.getDefectDetails).toHaveBeenCalledTimes(2);
    expect(vi.mocked(rtyApi.getDefectDetails).mock.calls.map(([batch]) => batch.length)).toEqual([200, 200]);
  });

  it('skips queries for rows without faults', async () => {
    expect(await loadFaultExportRows([])).toEqual([]);
    expect(rtyApi.getDefectDetails).not.toHaveBeenCalled();
  });
});
