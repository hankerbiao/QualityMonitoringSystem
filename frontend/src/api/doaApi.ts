import { requestJson } from './authApi';
import type { DoaDashboard, DoaFilters, DoaOptions, DoaRawDashboard, DoaRawFilters, DoaRepairsResponse } from '../types/doa';

function query(filters: DoaFilters, extra: Record<string, string | number> = {}) {
  const params = new URLSearchParams();
  Object.entries({ ...filters, ...extra }).forEach(([key, value]) => {
    if (value !== '' && value !== undefined && value !== null) params.set(key, String(value));
  });
  return params.toString() ? `?${params.toString()}` : '';
}

export const doaApi = {
  async getOptions(): Promise<DoaOptions> {
    return requestJson<DoaOptions>('/api/doa/options');
  },
  async getDashboard(filters: DoaFilters): Promise<DoaDashboard> {
    return requestJson<DoaDashboard>(`/api/doa/dashboard${query(filters)}`);
  },
  async getRepairs(filters: DoaFilters, page = 1, limit = 50, replacementOnly = false): Promise<DoaRepairsResponse> {
    const extra: Record<string, string | number> = replacementOnly
      ? { page, limit, replacementOnly: 'true' }
      : { page, limit };
    return requestJson<DoaRepairsResponse>(`/api/doa/repairs${query(filters, extra)}`);
  },
  async getRaw(page = 1, limit = 50, filters: DoaRawFilters = {}): Promise<DoaRawDashboard> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return requestJson<DoaRawDashboard>(`/api/doa/raw?${params}`);
  },
  buildQuery(filters: DoaFilters, extra: Record<string, string | number> = {}) {
    return query(filters, extra).replace(/^\?/, '');
  },
};
