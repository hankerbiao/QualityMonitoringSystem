import { apiFetch } from './authApi';
import type { MFRDashboard, MFRFilters } from '../types/mfr';

export const mfrApi = {
  async getDashboard(filters: MFRFilters): Promise<MFRDashboard> {
    const params = new URLSearchParams({ dateFrom: filters.dateFrom, dateTo: filters.dateTo });
    if (filters.model) params.set('model', filters.model);
    const response = await apiFetch(`/api/mfr/dashboard?${params.toString()}`);
    if (!response.ok) throw new Error('MFR 数据加载失败');
    return (await response.json()) as MFRDashboard;
  },
};
