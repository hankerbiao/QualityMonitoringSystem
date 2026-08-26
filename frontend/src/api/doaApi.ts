import { apiFetch } from './authApi';
import type { DoaDashboard, DoaFilters, DoaOptions, DoaRawDashboard, DoaRepairsResponse } from '../types/doa';

function query(filters: DoaFilters, extra: Record<string, string | number> = {}) {
  const params = new URLSearchParams();
  Object.entries({ ...filters, ...extra }).forEach(([key, value]) => {
    if (value !== '' && value !== undefined && value !== null) params.set(key, String(value));
  });
  return params.toString() ? `?${params.toString()}` : '';
}

export const doaApi = {
  async getOptions(): Promise<DoaOptions> {
    const response = await apiFetch('/api/doa/options');
    if (!response.ok) throw new Error('DOA 筛选项加载失败');
    return (await response.json()) as DoaOptions;
  },
  async getDashboard(filters: DoaFilters): Promise<DoaDashboard> {
    const response = await apiFetch(`/api/doa/dashboard${query(filters)}`);
    if (!response.ok) throw new Error('DOA 看板加载失败');
    return (await response.json()) as DoaDashboard;
  },
  async getRepairs(filters: DoaFilters, page = 1, limit = 50, replacementOnly = false): Promise<DoaRepairsResponse> {
    const extra: Record<string, string | number> = replacementOnly
      ? { page, limit, replacementOnly: 'true' }
      : { page, limit };
    const response = await apiFetch(`/api/doa/repairs${query(filters, extra)}`);
    if (!response.ok) throw new Error('DOA 报修明细加载失败');
    return (await response.json()) as DoaRepairsResponse;
  },
  async getRaw(page = 1, limit = 50): Promise<DoaRawDashboard> {
    const response = await apiFetch(`/api/doa/raw?page=${page}&limit=${limit}`);
    if (!response.ok) throw new Error('DOA 数据加载失败');
    return (await response.json()) as DoaRawDashboard;
  },
  buildQuery(filters: DoaFilters, extra: Record<string, string | number> = {}) {
    return query(filters, extra).replace(/^\?/, '');
  },
};
