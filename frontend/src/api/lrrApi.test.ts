// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearLrrApiCache, lrrApi } from './lrrApi';
import { requestJson } from './authApi';

vi.mock('./authApi', () => ({ requestJson: vi.fn() }));

describe('lrrApi full material list', () => {
  afterEach(() => {
    clearLrrApiCache();
    vi.mocked(requestJson).mockReset();
  });

  it('fetches every page with the same filters', async () => {
    vi.mocked(requestJson)
      .mockResolvedValueOnce({
        items: Array.from({ length: 500 }, (_, index) => ({
          id: `PN-${index + 1}:2026-09`,
          materialNumber: `PN-${index + 1}`,
        })),
        total: 501,
        page: 1,
        limit: 500,
      })
      .mockResolvedValueOnce({
        items: [{ id: 'PN-2:2026-09', materialNumber: 'PN-2' }],
        total: 501,
        page: 2,
        limit: 500,
      });

    const items = await lrrApi.getAllLRRData({
      plannedDateFrom: '2026-09-01',
      plannedDateTo: '2026-09-30',
      customerIds: ['A01', 'B01'],
    });

    expect(items).toHaveLength(501);
    expect(items[0].id).toBe('PN-1:2026-09');
    expect(items[500].id).toBe('PN-2:2026-09');
    expect(vi.mocked(requestJson).mock.calls.map(([url]) => url)).toEqual([
      '/api/lrr/list?plannedDateFrom=2026-09-01&plannedDateTo=2026-09-30&customerId=A01&customerId=B01&page=1&limit=500',
      '/api/lrr/list?plannedDateFrom=2026-09-01&plannedDateTo=2026-09-30&customerId=A01&customerId=B01&page=2&limit=500',
    ]);
  });

  it('passes an abort signal to the list request', async () => {
    vi.mocked(requestJson).mockResolvedValueOnce({ items: [], total: 0, page: 1, limit: 50 });
    const controller = new AbortController();

    await lrrApi.getLRRData(1, 50, { plannedDateFrom: '2026-01-01' }, controller.signal);

    expect(vi.mocked(requestJson).mock.calls[0][1]).toEqual({ signal: controller.signal });
  });

  it('reuses completed fault details requests during the page session', async () => {
    vi.mocked(requestJson).mockResolvedValue({ items: [], total: 0, truncated: false });
    const filters = { plannedDateFrom: '2026-09-01', plannedDateTo: '2026-09-30' };

    await lrrApi.getFaultDetails(filters);
    await lrrApi.getFaultDetails(filters);

    expect(vi.mocked(requestJson)).toHaveBeenCalledTimes(1);
  });

  it.each(['before', 'after'])('isolates an old pending response completed %s refresh', async (order) => {
    let resolveOld!: (value: unknown) => void;
    let resolveFresh!: (value: unknown) => void;
    vi.mocked(requestJson)
      .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveFresh = resolve; }));
    const filters = { materialNumber: 'PN-1' };
    const oldValue = { items: [], total: 0, truncated: false };
    const freshValue = { items: [], total: 1, truncated: false };

    const old = lrrApi.getFaultDetails(filters);
    clearLrrApiCache();
    const fresh = lrrApi.getFaultDetails(filters);
    expect(requestJson).toHaveBeenCalledTimes(2);

    if (order === 'before') {
      resolveOld(oldValue);
      await old;
      const shared = lrrApi.getFaultDetails(filters);
      expect(requestJson).toHaveBeenCalledTimes(2);
      resolveFresh(freshValue);
      expect(await shared).toEqual(freshValue);
    } else {
      resolveFresh(freshValue);
      await fresh;
      resolveOld(oldValue);
      await old;
    }
    expect(await fresh).toEqual(freshValue);
    expect(await lrrApi.getFaultDetails(filters)).toEqual(freshValue);
    expect(requestJson).toHaveBeenCalledTimes(2);
  });

  it('does not cache a list response started before a clear', async () => {
    let resolveOld!: (value: unknown) => void;
    vi.mocked(requestJson)
      .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ items: [], total: 1, page: 1, limit: 50 });
    const old = lrrApi.getLRRData(1, 50, {}, new AbortController().signal);
    clearLrrApiCache();
    resolveOld({ items: [], total: 0, page: 1, limit: 50 });
    await old;

    expect((await lrrApi.getLRRData()).total).toBe(1);
    expect(requestJson).toHaveBeenCalledTimes(2);
  });
});
