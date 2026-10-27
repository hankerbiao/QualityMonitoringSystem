// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { alertReportApi } from './alertReport';

afterEach(() => vi.unstubAllGlobals());

describe('alert report fault export', () => {
  it('fetches details using the report token without login credentials', async () => {
    const rows = [{ PCODE: '000001', ZNGWD3: '完整不良现象', ZWXWD3: '更换部件' }];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: true, data: rows }),
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(await alertReportApi.getFaultExport('signed.token')).toEqual(rows);
    expect(fetchMock).toHaveBeenCalledWith('/api/alert-report/signed.token/export', {
      method: 'GET', headers: { 'Content-Type': 'application/json' },
    });
  });

  it('reports expired-link errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: false, error: '链接已过期' }),
    }));
    await expect(alertReportApi.getFaultExport('expired.token')).rejects.toThrow('链接已过期');
  });

  it('reports HTTP failures before attempting to read data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }));
    await expect(alertReportApi.getFaultExport('signed.token')).rejects.toThrow('HTTP 502');
  });
});
