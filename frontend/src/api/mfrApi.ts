import { requestJson } from './authApi';
import type { MFRDashboard, MFRFilters } from '../types/mfr';

export const mfrApi = {
  async getDashboard(filters: MFRFilters): Promise<MFRDashboard> {
    const params = new URLSearchParams({ dateFrom: filters.dateFrom, dateTo: filters.dateTo });
    if (filters.model) params.set('model', filters.model);
    return requestJson<MFRDashboard>(`/api/mfr/dashboard?${params.toString()}`);
  },
};
