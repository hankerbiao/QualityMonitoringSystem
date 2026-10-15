// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccessToken, getCurrentUser, loginWithPassword } from './api/authApi';
import { useAuth } from './context/AuthContext';
import App from './App';

vi.mock('./api/authApi', () => ({
  getCurrentUser: vi.fn(), getAccessToken: vi.fn(), loginWithPassword: vi.fn(),
  registerUnauthorizedHandler: vi.fn(), setAccessToken: vi.fn(),
  setRefreshToken: vi.fn(), clearTokens: vi.fn(),
}));
vi.mock('./api/operationsApi', () => ({
  operationsApi: { trackPageView: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('./context/SettingsContext', () => ({
  SettingsProvider: ({ children }: { children: ReactNode }) => children,
  useSettings: () => ({ settings: { dashboardStatuses: {} } }),
}));
vi.mock('./pages/Home', () => ({
  default: () => {
    const { logout } = useAuth();
    return <main><h1>Home</h1><Link to="/rty">RTY</Link><button onClick={logout}>Sign out</button></main>;
  },
}));
vi.mock('./pages/RTYPage', () => ({
  default: () => <main><h1>RTY</h1><Link to="/">Home</Link></main>,
}));
vi.mock('./pages/LoginPage', () => ({
  default: () => {
    const { login } = useAuth();
    return <button onClick={() => void login('alice', 'test-password')}>Sign in</button>;
  },
}));
vi.mock('./pages/AlertReportPage', () => ({
  default: () => <h1>Alert report</h1>,
}));

const user = { itcode: 'alice', role: 'user', dashboardPermissions: ['rty'] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAccessToken).mockReturnValue('existing-token');
  vi.mocked(getCurrentUser).mockResolvedValue({ itcode: user.itcode, user });
  vi.mocked(loginWithPassword).mockResolvedValue({
    ok: true, user, access_token: 'access-token', refresh_token: 'refresh-token',
  });
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe.each(['', '/QualiBoard'])('application entry %s', prefix => {
  it('renders the entry without changing its address and keeps navigation under that entry', async () => {
    const entry = prefix || '/';
    window.history.replaceState(null, '', entry);
    render(<App />);
    await screen.findByRole('heading', { name: 'Home' });
    expect(window.location.pathname).toBe(entry);
    const link = screen.getByRole('link', { name: 'RTY' });
    expect(link.getAttribute('href')).toBe(`${prefix}/rty`);
    fireEvent.click(link);
    await screen.findByRole('heading', { name: 'RTY' });
    expect(window.location.pathname).toBe(`${prefix}/rty`);
    fireEvent.click(screen.getByRole('link', { name: 'Home' }));
    await screen.findByRole('heading', { name: 'Home' });
    expect(window.location.pathname).toBe(entry);
  });

  it('keeps login and logout within the chosen entry', async () => {
    vi.mocked(getAccessToken).mockReturnValue(null);
    window.history.replaceState(null, '', prefix || '/');
    render(<App />);
    const signIn = await screen.findByRole('button', { name: 'Sign in' });
    expect(window.location.pathname).toBe(`${prefix}/login`);
    fireEvent.click(signIn);
    await screen.findByRole('heading', { name: 'Home' });
    expect(window.location.pathname).toBe(prefix || '/');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('button', { name: 'Sign in' });
    expect(window.location.pathname).toBe(`${prefix}/login`);
  });

  it('loads a bookmarked dashboard after a full page reload', async () => {
    window.history.replaceState(null, '', `${prefix}/rty?model=M`);
    const view = render(<App />);
    await screen.findByRole('heading', { name: 'RTY' });
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'RTY' });
    expect(window.location.pathname).toBe(`${prefix}/rty`);
    expect(window.location.search).toBe('?model=M');
  });

  it('loads public reports without forcing authentication', async () => {
    vi.mocked(getAccessToken).mockReturnValue(null);
    window.history.replaceState(null, '', `${prefix}/alert-report/test-token`);
    render(<App />);
    await screen.findByRole('heading', { name: 'Alert report' });
    expect(window.location.pathname).toBe(`${prefix}/alert-report/test-token`);
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });
});

it('supports the QualiBoard entry with a trailing slash and query parameters', async () => {
  window.history.replaceState(null, '', '/QualiBoard/?from=bookmark');
  render(<App />);
  await screen.findByRole('heading', { name: 'Home' });
  expect(window.location.pathname).toBe('/QualiBoard/');
  expect(window.location.search).toBe('?from=bookmark');
});
