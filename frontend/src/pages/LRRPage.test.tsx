// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { lrrApi } from '../api/lrrApi';
import LRRPage from './LRRPage';

vi.mock('../api/lrrApi', () => ({
  clearLrrApiCache: vi.fn(),
  lrrApi: { getOptions: vi.fn(), getLRRData: vi.fn(), getFaultDetails: vi.fn(), getAllLRRData: vi.fn() },
}));
vi.mock('../components/shared/DashboardSwitcher', () => ({ DashboardSwitcher: () => null }));
vi.mock('../components/shared/HelpTooltip', () => ({ HelpTooltip: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock('../components/ui', () => ({ LoadingSpinner: () => <span /> }));
vi.mock('recharts', () => ({
  Bar: () => null, CartesianGrid: () => null, ComposedChart: () => null,
  Line: () => null, ResponsiveContainer: () => null, Tooltip: () => null,
  XAxis: () => null, YAxis: () => null,
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('shows an empty overview before the first query without loading dashboard data', async () => {
  vi.mocked(lrrApi.getOptions).mockResolvedValue({ materialNumbers: [], productModels: [], bases: [], customerIds: [] });
  render(<MemoryRouter><LRRPage /></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: '物料质量概览' })).toBeTruthy();
  expect(screen.getAllByText('待查询').length).toBeGreaterThan(0);
  expect(lrrApi.getLRRData).not.toHaveBeenCalled();
});
