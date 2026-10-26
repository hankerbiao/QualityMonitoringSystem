import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { settingsApi } from '../api/settingsApi';
import { useAuth } from './AuthContext';
import type { SettingsContextType, SettingsResponse, SettingsUpdate } from '../types';
import { DEFAULT_DASHBOARD_STATUSES } from '../config/homeModules';
import {
  DEFAULT_TRIGGER_CONDITION,
  DEFAULT_WEEKLY_PRODUCTION_THRESHOLD,
} from '../utils/emailAlert';

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

const DEFAULT_SETTINGS: SettingsResponse = {
  processRecords: { username: '', password: '', hasPassword: false },
  modelTargets: {},
  emailAlert: {
    enabled: true,
    emails: '',
    triggerCondition: DEFAULT_TRIGGER_CONDITION,
    weeklyProductionThreshold: DEFAULT_WEEKLY_PRODUCTION_THRESHOLD,
  },
  dashboardStatuses: DEFAULT_DASHBOARD_STATUSES,
  cycleStatsConfig: { selectedModels: [] },
  stationPassRateConfig: { selectedStations: [], configured: false },
};

type SettingsLoadResult =
  | { key: string; settings: SettingsResponse; error: null }
  | { key: string; settings: null; error: string };

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user, isAuthLoaded, isAuthenticated } = useAuth();
  const [result, setResult] = useState<SettingsLoadResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const requestKey = JSON.stringify([user?.username, user?.itcode, user?.role, attempt]);
  const current = isAuthLoaded && isAuthenticated && result?.key === requestKey ? result : null;
  const settings = current?.settings ?? DEFAULT_SETTINGS;
  const loading = !isAuthLoaded || (isAuthenticated && current === null);
  const error = current?.error ?? null;
  const reloadSettings = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    if (!isAuthLoaded || !isAuthenticated) {
      setResult(null);
      return;
    }

    let active = true;
    const loadSettings = async () => {
      try {
        const [dashboardStatuses, accessibleSettings] = await Promise.all([
          settingsApi.getDashboardStatuses(),
          settingsApi.getAll(),
        ]);
        if (active) {
          setResult({
            key: requestKey,
            settings: { ...DEFAULT_SETTINGS, ...accessibleSettings, dashboardStatuses },
            error: null,
          });
        }
      } catch (err) {
        if (active) {
          setResult({
            key: requestKey,
            settings: null,
            error: err instanceof Error && err.message ? err.message : '配置加载失败，请重试',
          });
        }
      }
    };

    void loadSettings();
    window.addEventListener('settings-saved', reloadSettings);

    return () => {
      active = false;
      window.removeEventListener('settings-saved', reloadSettings);
    };
  }, [isAuthLoaded, isAuthenticated, requestKey, reloadSettings]);

  const updateSettings = useCallback(async (config: SettingsUpdate) => {
    if (!current?.settings) throw new Error('配置尚未成功加载，请重新加载后保存');
    const updated = await settingsApi.updateAll(config);
    setResult(previous => previous?.key === requestKey && previous.settings
      ? { ...previous, settings: { ...previous.settings, ...updated } }
      : previous);
  }, [current, requestKey]);

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, loading, error, reloadSettings }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
