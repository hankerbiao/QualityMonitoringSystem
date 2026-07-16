import { LRRData, PaginatedLRRResponse } from '../types';
import { apiFetch } from './authApi';

export const lrrApi = {
  async getLRRData(page = 1, pageSize = 50, filter = 'all'): Promise<PaginatedLRRResponse> {
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('limit', String(pageSize));
    if (filter !== 'all') qs.set('filter', filter);
    const res = await apiFetch(`/api/lrr/list?${qs}`);
    const json = await res.json();
    return json as PaginatedLRRResponse;
  },
};

export type { LRRData, PaginatedLRRResponse };
