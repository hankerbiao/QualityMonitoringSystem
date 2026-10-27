// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccessToken, getCurrentUser } from '../api/authApi';
import { AuthProvider } from '../context/AuthContext';
import type { UserProfile } from '../types';
import Home from './Home';

vi.mock('../api/authApi', () => ({
  getCurrentUser: vi.fn(), getAccessToken: vi.fn(), loginWithPassword: vi.fn(),
  registerUnauthorizedHandler: vi.fn(), setAccessToken: vi.fn(), setRefreshToken: vi.fn(), clearTokens: vi.fn(),
}));
vi.mock('../context/SettingsContext', () => ({
  useSettings: () => ({ settings: { dashboardStatuses: testDashboardStatuses } }),
}));

const testDashboardStatuses: Record<string, 'available' | 'planned' | 'admin-only'> = {};

const normalUser: UserProfile = {
  itcode: 'alice', username: 'alice', name: 'Alice', role: 'user',
  dashboardPermissions: ['rty', 'station-pass-rate', 'repair-quality', 'lrr', 'process-records', 'doa', 'doa-repairs', 'mfr'],
};
const response = (role: UserProfile['role']) => ({
  itcode: 'alice', user: { ...normalUser, role },
});

describe('home administrator settings access', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    Object.keys(testDashboardStatuses).forEach(key => delete testDashboardStatuses[key]);
    vi.mocked(getAccessToken).mockReturnValue('existing-token');
    vi.mocked(getCurrentUser).mockResolvedValue(response('user'));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('keeps shared settings available while administrator modules follow role changes', async () => {
    await act(async () => {
      render(<MemoryRouter><AuthProvider><Home /></AuthProvider></MemoryRouter>);
    });
    await screen.findByText('Alice');
    expect(screen.getByRole('button', { name: '系统配置管理' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: '运营监控' })).toBeNull();

    vi.mocked(getCurrentUser).mockResolvedValue(response('admin'));
    fireEvent(window, new Event('focus'));
    expect(await screen.findByRole('button', { name: '系统配置管理' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '运营监控' })).toBeTruthy();

    vi.mocked(getCurrentUser).mockResolvedValue(response('user'));
    await act(async () => { fireEvent(window, new Event('focus')); });
    expect(screen.getByRole('button', { name: '系统配置管理' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: '运营监控' })).toBeNull();
  });

  it('hides admin-only dashboards from ordinary users and shows them to admins', async () => {
    testDashboardStatuses.doa = 'admin-only';
    await act(async () => {
      render(<MemoryRouter><AuthProvider><Home /></AuthProvider></MemoryRouter>);
    });
    await screen.findByText('Alice');
    expect(screen.queryByText('DOA 报修率')).toBeNull();

    vi.mocked(getCurrentUser).mockResolvedValue(response('admin'));
    await act(async () => { fireEvent(window, new Event('focus')); });
    expect(await screen.findByText('DOA 报修率')).toBeTruthy();
  });

  it('keeps repair quality administrator-only by default', async () => {
    await act(async () => {
      render(<MemoryRouter><AuthProvider><Home /></AuthProvider></MemoryRouter>);
    });
    await screen.findByText('Alice');
    expect(screen.queryByText('维修首修通过率分析')).toBeNull();
    vi.mocked(getCurrentUser).mockResolvedValue(response('admin'));
    await act(async () => { fireEvent(window, new Event('focus')); });
    expect(await screen.findByText('维修首修通过率分析')).toBeTruthy();
  });
});
