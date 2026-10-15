import { requestJson } from './authApi';
import { API_BASE_URL } from '../constants';
import type { MFRDashboard, MFRFilters } from '../types/mfr';

export const mfrApi = {
  async getDashboard(filters: MFRFilters): Promise<MFRDashboard> {
    const params = new URLSearchParams({ dateFrom: filters.dateFrom, dateTo: filters.dateTo });
    if (filters.model) params.set('model', filters.model);
    return requestJson<MFRDashboard>(`${API_BASE_URL}/mfr/dashboard?${params.toString()}`);
  },
};
