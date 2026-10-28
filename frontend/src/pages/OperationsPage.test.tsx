// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { operationsApi } from '../api/operationsApi';
import OperationsPage from './OperationsPage';

vi.mock('../api/operationsApi', () => ({ operationsApi: { getDashboard: vi.fn() } }));
vi.mock('recharts', () => ({
  ResponsiveContainer: () => null, ComposedChart: () => null, Bar: () => null,
  CartesianGrid: () => null, Line: () => null, Tooltip: () => null,
  XAxis: () => null, YAxis: () => null,
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('paginates access records and resets to the first page when the period changes', async () => {
  vi.mocked(operationsApi.getDashboard).mockImplementation(async (_days, page = 1) => ({
    period: { days: 30, start: '', end: '', generatedAt: '2026-10-28T00:00:00Z' },
    summary: { activeUsers: 1, currentOnline: 1, totalUsers: 1, visits: 1, pageViews: 21, apiRequests: 0,
      successRate: 100, avgResponseMs: 0, changes: { activeUsers: null, visits: null, pageViews: null, successRate: null } },
    trend: [], modules: [], health: { status: 'healthy', database: 'healthy', errorRequests: 0, lastEventAt: null },
    syncDataSources: [], activityTotal: 21,
    recentActivity: [{ id: String(page), itcode: `user${page}`, displayName: `用户${page}`,
      action: '访问页面', module: 'MFR', timestamp: '2026-10-28T00:00:00Z', status: 'success' }],
  }));
  render(<MemoryRouter><OperationsPage /></MemoryRouter>);
  await screen.findByText('用户1');
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  await screen.findByText('用户2');
  fireEvent.click(screen.getByRole('button', { name: '7 天' }));
  await waitFor(() => expect(operationsApi.getDashboard).toHaveBeenLastCalledWith(7, 1));
});
