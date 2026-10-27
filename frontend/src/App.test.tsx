// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const state = vi.hoisted(() => ({
  loading: true,
  error: null as string | null,
  status: 'available',
  reload: vi.fn(),
}));
vi.mock('./context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    isAuthLoaded: true, isAuthenticated: true,
    user: { username: 'test', role: 'user', dashboardPermissions: ['doa'] },
  }),
}));
vi.mock('./context/SettingsContext', () => ({
  SettingsProvider: ({ children }: { children: React.ReactNode }) => children,
  useSettings: () => ({
    loading: state.loading, error: state.error, reloadSettings: state.reload,
    settings: { dashboardStatuses: { doa: state.status } },
  }),
}));
vi.mock('./api/operationsApi', () => ({ operationsApi: { trackPageView: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('./pages/DoaPage', () => ({ default: () => <div>DOA 看板内容</div> }));

describe('dashboard status on refresh', () => {
  afterEach(() => { cleanup(); state.loading = true; state.error = null; state.status = 'available'; state.reload.mockClear(); });

  it('waits for the saved status before rendering and respects administrator-only access', async () => {
    window.history.pushState({}, '', '/doa');
    const view = render(<App />);
    expect(screen.queryByText('DOA 看板内容')).toBeNull();
    expect(screen.queryByText(/正在开发/)).toBeNull();
    state.loading = false;
    state.status = 'admin-only';
    view.rerender(<App />);
    expect(await screen.findByText('仅管理员可见')).toBeTruthy();
    expect(screen.queryByText('DOA 看板内容')).toBeNull();
    state.status = 'available';
    view.rerender(<App />);
    expect(await screen.findByText('DOA 看板内容')).toBeTruthy();
  });

  it('offers a retry when status settings cannot be loaded', () => {
    window.history.pushState({}, '', '/doa');
    state.loading = false;
    state.error = '连接失败';
    render(<App />);
    expect(screen.getByRole('alert').textContent).toContain('连接失败');
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(state.reload).toHaveBeenCalledOnce();
    expect(screen.queryByText('DOA 看板内容')).toBeNull();
  });
});
