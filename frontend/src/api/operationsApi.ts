import { requestJson } from './authApi';
import { API_BASE_URL } from '../constants';
import type { OperationsDashboard, OperationsDays } from '../types';

let lastTrackedPath = '';
let lastTrackedAt = 0;

export const operationsApi = {
  async getDashboard(days: OperationsDays, page?: number): Promise<OperationsDashboard> {
    const pagination = page === undefined ? '' : `&activityPage=${page}&activityPageSize=20`;
    return requestJson<OperationsDashboard>(`${API_BASE_URL}/operations/dashboard?days=${days}${pagination}`);
  },

  async trackPageView(path: string): Promise<void> {
    const now = Date.now();
    if (path === lastTrackedPath && now - lastTrackedAt < 2000) return;
    lastTrackedPath = path;
    lastTrackedAt = now;

    await requestJson(`${API_BASE_URL}/operations/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: 'page_view', path }),
    });
  },
};
