// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rtyApi } from '../api/rtyApi';
import StationPassRatePage from './StationPassRatePage';

vi.mock('../api/rtyApi', () => ({
  rtyApi: {
    getFilterOptions: vi.fn(),
    getStationPassRates: vi.fn(),
    getStationPassDetails: vi.fn(),
  },
}));
vi.mock('../context/SettingsContext', () => ({
  useSettings: () => ({
    settings: { stationPassRateConfig: { selectedStations: [], configured: false } },
    updateSettings: vi.fn(),
  }),
}));
vi.mock('../components/shared/DashboardSwitcher', () => ({ DashboardSwitcher: () => null }));
vi.mock('../components/shared/MonthQuickPicker', () => ({ MonthQuickPicker: () => null }));
vi.mock('../components/station/StationPassWorkspace', () => ({
  StationPassFindings: () => null,
  StationQueryLaunch: () => null,
}));

describe('StationPassRatePage customer filter', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(rtyApi.getFilterOptions).mockResolvedValue({
      productModels: [],
      bases: [],
      customers: ['CUST-A'],
    });
    vi.mocked(rtyApi.getStationPassRates).mockResolvedValue([]);
    vi.mocked(rtyApi.getStationPassDetails).mockResolvedValue([]);
  });
  afterEach(cleanup);

  it('passes the selected customer to the station query', async () => {
    render(<MemoryRouter><StationPassRatePage /></MemoryRouter>);

    await screen.findByRole('option', { name: 'CUST-A' });
    fireEvent.change(screen.getByLabelText('客户 ID'), { target: { value: 'CUST-A' } });
    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    await waitFor(() => expect(rtyApi.getStationPassRates).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'CUST-A' }),
    ));
  });
});
