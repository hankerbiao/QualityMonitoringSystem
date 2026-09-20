import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { settingsApi } from '../api/settingsApi';
import { useAuth } from './AuthContext';
import type { SettingsContextType, SettingsResponse, SettingsUpdate } from '../types';

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

const DEFAULT_SETTINGS: SettingsResponse = {
  processRecords: { username: '', password: '', hasPassword: false },
  modelTargets: {},
  emailAlert: { enabled: true, emails: '', triggerCondition: '', weeklyProductionThreshold: 50 },
  cycleStatsConfig: { selectedModels: [] },
  stationPassRateConfig: { selectedStations: [], configured: false },
};

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { isAuthLoaded, isAuthenticated } = useAuth();
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
        const data = await settingsApi.getAll();
        if (active) setSettings({ ...DEFAULT_SETTINGS, ...data });
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
  }, [isAuthLoaded, isAuthenticated]);

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
