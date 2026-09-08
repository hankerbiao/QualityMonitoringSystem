import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearRtyApiCache, rtyApi } from './rtyApi';
import { apiFetch } from './authApi';
import type { RTYFilterParams } from '../types';

vi.mock('./authApi', () => ({ apiFetch: vi.fn() }));

describe('rtyApi list cache', () => {
  afterEach(() => {
    clearRtyApiCache();
    vi.mocked(apiFetch).mockReset();
  });

  it('coalesces identical list requests', async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({
      items: [], total: 0, page: 1, limit: 50, has_more: false,
    }), { status: 200 }));
    const filters: RTYFilterParams = {
      dateRange: { from: undefined, to: undefined }, productModel: 'all', customer: '', base: 'all', salesOrder: '',
      productionOrder: '', serialNumber: '', orderScope: 'normal' as const,
    };

    await Promise.all([rtyApi.getRTYData(filters), rtyApi.getRTYData(filters)]);

    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});
