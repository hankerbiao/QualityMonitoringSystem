import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearRtyApiCache, rtyApi } from './rtyApi';
import { requestData, requestJson } from './authApi';
import type { RTYFilterParams } from '../types';

vi.mock('./authApi', () => ({ requestData: vi.fn(), requestJson: vi.fn() }));

describe('rtyApi list cache', () => {
  afterEach(() => {
    clearRtyApiCache();
    vi.mocked(requestData).mockReset();
    vi.mocked(requestJson).mockReset();
  });

  it('coalesces identical list requests', async () => {
    vi.mocked(requestJson).mockResolvedValue({
      items: [], total: 0, page: 1, limit: 50, has_more: false,
    });
    const filters: RTYFilterParams = {
      dateRange: { from: undefined, to: undefined }, productModel: 'all', customer: '', base: 'all', salesOrder: '',
      productionOrder: '', serialNumber: '', orderScope: 'normal' as const,
    };

    await Promise.all([rtyApi.getRTYData(filters), rtyApi.getRTYData(filters)]);

    expect(requestJson).toHaveBeenCalledTimes(1);
  });

  it('sends exact cycle date bounds and keeps each range in a separate cache entry', async () => {
    vi.mocked(requestData).mockResolvedValue([]);

    await rtyApi.getCycleData('normal', undefined, {
      dateFrom: '2026-04-14',
      dateTo: '2026-04-20',
    });
    await rtyApi.getCycleData('normal', undefined, {
      dateFrom: '2026-04-15',
      dateTo: '2026-04-20',
    });

    expect(requestData).toHaveBeenNthCalledWith(
      1,
      '/api/rty/cycle-data?orderScope=normal&dateFrom=2026-04-14&dateTo=2026-04-20',
    );
    expect(requestData).toHaveBeenNthCalledWith(
      2,
      '/api/rty/cycle-data?orderScope=normal&dateFrom=2026-04-15&dateTo=2026-04-20',
    );
  });
});
