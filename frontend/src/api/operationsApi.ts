import { apiFetch } from './authApi';
import type { OperationsDashboard, OperationsDays } from '../types';

let lastTrackedPath = '';
let lastTrackedAt = 0;

export const operationsApi = {
  async getDashboard(days: OperationsDays): Promise<OperationsDashboard> {
    const response = await apiFetch(`/api/operations/dashboard?days=${days}`);
    if (!response.ok) throw new Error('运营数据加载失败');
    return (await response.json()) as OperationsDashboard;
  },

  async trackPageView(path: string): Promise<void> {
    const now = Date.now();
    if (path === lastTrackedPath && now - lastTrackedAt < 2000) return;
    lastTrackedPath = path;
    lastTrackedAt = now;

    const response = await apiFetch('/api/operations/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: 'page_view', path }),
    });
    if (!response.ok) throw new Error('页面访问记录失败');
  },
};
