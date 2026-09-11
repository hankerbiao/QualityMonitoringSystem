import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearRtyApiCache, rtyApi } from './rtyApi';
import { requestJson } from './authApi';
import type { RTYFilterParams } from '../types';

vi.mock('./authApi', () => ({ requestJson: vi.fn() }));

describe('rtyApi list cache', () => {
  afterEach(() => {
    clearRtyApiCache();
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
});
