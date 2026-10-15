// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearTokens, getAccessToken, getCurrentUser } from '../api/authApi';
import type { UserProfile } from '../types';
import { AuthProvider, useAuth } from './AuthContext';

vi.mock('../api/authApi', () => ({
  getCurrentUser: vi.fn(), getAccessToken: vi.fn(), loginWithPassword: vi.fn(),
  registerUnauthorizedHandler: vi.fn(), setAccessToken: vi.fn(), setRefreshToken: vi.fn(), clearTokens: vi.fn(),
}));

const normalUser: UserProfile = {
  itcode: 'alice', username: 'alice', role: 'user', dashboardPermissions: ['rty'],
};
const administrator: UserProfile = {
  ...normalUser, role: 'admin', dashboardPermissions: ['rty', 'lrr'],
};
const response = (user: UserProfile) => ({ itcode: 'alice', user });

function Profile() {
  const { user, isAuthLoaded, logout } = useAuth();
  return (
    <div>
      <span>{isAuthLoaded ? user?.role || '已退出' : '加载中'}</span>
      <span>{user?.dashboardPermissions?.join(',')}</span>
      <button onClick={logout}>退出</button>
    </div>
  );
}

async function renderProfile() {
  await act(async () => {
    render(<MemoryRouter><AuthProvider><Profile /></AuthProvider></MemoryRouter>);
  });
}

describe('administrator profile synchronization', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAccessToken).mockReturnValue('existing-token');
    vi.mocked(getCurrentUser).mockResolvedValue(response(normalUser));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('updates permissions after promotion and demotion when returning to the page', async () => {
    await renderProfile();
    await screen.findByText('user');
    vi.mocked(getCurrentUser).mockResolvedValue(response(administrator));
    fireEvent(window, new Event('focus'));
    await screen.findByText('admin');
    expect(screen.getByText('rty,lrr')).toBeTruthy();

    vi.mocked(getCurrentUser).mockResolvedValue(response(normalUser));
    fireEvent(document, new Event('visibilitychange'));
    await screen.findByText('user');
    expect(screen.getByText('rty')).toBeTruthy();
  });

  it('refreshes visible profiles every minute and skips hidden pages', async () => {
    vi.useFakeTimers();
    await renderProfile();
    expect(screen.getByText('user')).toBeTruthy();
    vi.mocked(getCurrentUser).mockResolvedValue(response(administrator));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.getByText('admin')).toBeTruthy();
    expect(getCurrentUser).toHaveBeenCalledTimes(2);

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(getCurrentUser).toHaveBeenCalledTimes(2);
  });

  it('keeps the current user during a transient refresh failure', async () => {
    await renderProfile();
    await screen.findByText('user');
    vi.mocked(getCurrentUser).mockRejectedValueOnce(new Error('network unavailable'));
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(getCurrentUser).toHaveBeenCalledTimes(2));
    expect(screen.getByText('user')).toBeTruthy();
    expect(clearTokens).not.toHaveBeenCalled();
  });

  it('deduplicates refreshes and ignores a late response after logout', async () => {
    await renderProfile();
    await screen.findByText('user');
    let resolve!: (value: ReturnType<typeof response>) => void;
    vi.mocked(getCurrentUser).mockReturnValue(new Promise(done => { resolve = done; }));
    fireEvent(window, new Event('focus'));
    fireEvent(document, new Event('visibilitychange'));
    expect(getCurrentUser).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: '退出' }));
    await screen.findByText('已退出');
    await act(async () => { resolve(response(administrator)); });
    expect(screen.getByText('已退出')).toBeTruthy();
    expect(screen.queryByText('admin')).toBeNull();
    fireEvent(window, new Event('focus'));
    expect(getCurrentUser).toHaveBeenCalledTimes(2);
  });
});
