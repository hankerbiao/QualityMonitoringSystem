import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { settingsApi } from '../api/settingsApi';
import { useAuth } from './AuthContext';
import type { SettingsContextType, SettingsResponse, SettingsUpdate } from '../types';
import { DEFAULT_DASHBOARD_STATUSES } from '../config/homeModules';

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

const DEFAULT_SETTINGS: SettingsResponse = {
  processRecords: { username: '', password: '', hasPassword: false },
  modelTargets: {},
  emailAlert: { enabled: true, emails: '', triggerCondition: '', weeklyProductionThreshold: 50 },
  dashboardStatuses: DEFAULT_DASHBOARD_STATUSES,
  cycleStatsConfig: { selectedModels: [] },
  stationPassRateConfig: { selectedStations: [], configured: false },
};

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user, isAuthLoaded, isAuthenticated } = useAuth();
  const [settings, setSettings] = useState<SettingsResponse>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthLoaded) return;
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    let active = true;
    const loadSettings = async () => {
      try {
        const [dashboardStatuses, adminSettings] = await Promise.all([
          settingsApi.getDashboardStatuses(),
          user?.role === 'admin' ? settingsApi.getAll() : Promise.resolve(null),
        ]);
        if (active) {
          setSettings({
            ...DEFAULT_SETTINGS,
            ...(adminSettings ?? {}),
            dashboardStatuses,
          });
        }
      } catch (err) {
        console.error('[Settings] Failed to load from backend:', err);
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadSettings();
    const handleSettingsSaved = () => void loadSettings();
    window.addEventListener('settings-saved', handleSettingsSaved);

    return () => {
      active = false;
      window.removeEventListener('settings-saved', handleSettingsSaved);
    };
  }, [isAuthLoaded, isAuthenticated, user?.role]);

  const updateSettings = useCallback(async (config: SettingsUpdate) => {
    const updated = await settingsApi.updateAll(config);
    setSettings((current) => ({ ...current, ...updated }));
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, loading }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
