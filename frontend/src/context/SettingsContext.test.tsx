// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsApi } from '../api/settingsApi';
import { useAuth } from './AuthContext';
import { SettingsProvider, useSettings } from './SettingsContext';

vi.mock('../api/settingsApi', () => ({
  settingsApi: { getAll: vi.fn(), getDashboardStatuses: vi.fn(), updateAll: vi.fn() },
}));
vi.mock('./AuthContext', () => ({ useAuth: vi.fn() }));

const sharedSettings = {
  modelTargets: { X1: 98.5 },
  stationPassRateConfig: { selectedStations: ['OP10'], configured: true },
  emailAlert: {
    enabled: false, emails: 'quality@company.com', triggerCondition: 'existing-rule',
    weeklyProductionThreshold: 100,
  },
};

function setRole(role: 'user' | 'admin') {
  vi.mocked(useAuth).mockReturnValue({
    user: { itcode: 'alice', role }, isAuthenticated: true, isAuthLoaded: true,
    login: vi.fn(), logout: vi.fn(),
  });
}

describe('shared settings context', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setRole('user');
    vi.mocked(settingsApi.getAll).mockResolvedValue(sharedSettings);
    vi.mocked(settingsApi.getDashboardStatuses).mockResolvedValue({ doa: 'available' });
  });
  afterEach(() => cleanup());

  it('loads stored targets and email rules for ordinary users', async () => {
    const { result } = renderHook(() => useSettings(), { wrapper: SettingsProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings.modelTargets).toEqual({ X1: 98.5 });
    expect(result.current.settings.emailAlert).toEqual(sharedSettings.emailAlert);
    expect(result.current.settings.stationPassRateConfig).toEqual(sharedSettings.stationPassRateConfig);
    expect(result.current.settings.dashboardStatuses).toEqual({ doa: 'available' });
    expect(result.current.settings.processRecords.username).toBe('');
  });

  it('discards administrator settings when the role changes to an ordinary user', async () => {
    setRole('admin');
    vi.mocked(settingsApi.getAll).mockResolvedValueOnce({
      ...sharedSettings,
      processRecords: { username: 'private-source', password: '', hasPassword: true },
      dashboardStatuses: {}, cycleStatsConfig: { selectedModels: [] },
      stationPassRateConfig: { selectedStations: [], configured: false },
    });
    const { result, rerender } = renderHook(() => useSettings(), { wrapper: SettingsProvider });
    await waitFor(() => expect(result.current.settings.processRecords.username).toBe('private-source'));
    setRole('user');
    rerender();
    expect(result.current.settings.processRecords.username).toBe('');
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings.modelTargets).toEqual(sharedSettings.modelTargets);
    expect(result.current.settings.emailAlert).toEqual(sharedSettings.emailAlert);
  });

  it('merges a restricted save response without losing dashboard display settings', async () => {
    vi.mocked(settingsApi.updateAll).mockResolvedValue({
      ...sharedSettings, modelTargets: { X1: 99 },
    });
    const { result } = renderHook(() => useSettings(), { wrapper: SettingsProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.updateSettings({ modelTargets: { X1: 99 } }); });
    expect(result.current.settings.modelTargets).toEqual({ X1: 99 });
    expect(result.current.settings.dashboardStatuses).toEqual({ doa: 'available' });
  });

  it('blocks saving after a load failure and permits it after a successful retry', async () => {
    vi.mocked(settingsApi.getAll).mockRejectedValueOnce(new Error('读取失败'));
    vi.mocked(settingsApi.updateAll).mockResolvedValue(sharedSettings);
    const { result } = renderHook(() => useSettings(), { wrapper: SettingsProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('读取失败');
    await expect(result.current.updateSettings({ modelTargets: {} })).rejects.toThrow();
    expect(settingsApi.updateAll).not.toHaveBeenCalled();

    act(() => result.current.reloadSettings());
    await waitFor(() => expect(result.current.settings.modelTargets).toEqual({ X1: 98.5 }));
    expect(result.current.error).toBeNull();
    await act(async () => { await result.current.updateSettings({ modelTargets: { X1: 98.5 } }); });
    expect(settingsApi.updateAll).toHaveBeenCalledOnce();
  });

  it('blocks saving while settings are loading', async () => {
    vi.mocked(settingsApi.getAll).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useSettings(), { wrapper: SettingsProvider });
    expect(result.current.loading).toBe(true);
    await expect(result.current.updateSettings({ modelTargets: {} })).rejects.toThrow();
    expect(settingsApi.updateAll).not.toHaveBeenCalled();
  });

  it('ignores an old administrator load after the role changes', async () => {
    setRole('admin');
    let resolveOld!: (value: Awaited<ReturnType<typeof settingsApi.getAll>>) => void;
    vi.mocked(settingsApi.getAll).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
    const { result, rerender } = renderHook(() => useSettings(), { wrapper: SettingsProvider });
    setRole('user');
    rerender();
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      resolveOld({
        ...sharedSettings, processRecords: { username: 'private', password: '', hasPassword: true },
        dashboardStatuses: {}, cycleStatsConfig: { selectedModels: [] },
        stationPassRateConfig: { selectedStations: [], configured: false },
      });
    });
    expect(result.current.settings.processRecords.username).toBe('');
  });

  it('clears settings on logout and reloads for a different user with the same role', async () => {
    const { result, rerender } = renderHook(() => useSettings(), { wrapper: SettingsProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.mocked(useAuth).mockReturnValue({
      user: null, isAuthenticated: false, isAuthLoaded: true, login: vi.fn(), logout: vi.fn(),
    });
    rerender();
    expect(result.current.settings.modelTargets).toEqual({});
    await expect(result.current.updateSettings({ modelTargets: {} })).rejects.toThrow();

    vi.mocked(useAuth).mockReturnValue({
      user: { itcode: 'bob', role: 'user' }, isAuthenticated: true, isAuthLoaded: true,
      login: vi.fn(), logout: vi.fn(),
    });
    vi.mocked(settingsApi.getAll).mockResolvedValue({ ...sharedSettings, modelTargets: { B: 99 } });
    rerender();
    await waitFor(() => expect(result.current.settings.modelTargets).toEqual({ B: 99 }));
  });
});
