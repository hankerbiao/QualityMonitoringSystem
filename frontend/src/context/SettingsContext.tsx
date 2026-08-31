import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { settingsApi } from '../api/settingsApi';
import { useAuth } from './AuthContext';
import type { AIConfig, SettingsContextType, SettingsResponse, SettingsUpdate } from '../types';
import { DEFAULT_AI_CONFIG } from '../types';

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

const DEFAULT_SETTINGS: SettingsResponse = {
  processRecords: { username: '', password: '', hasPassword: false },
  modelTargets: {},
  emailAlert: { enabled: true, emails: '', triggerCondition: '', weeklyProductionThreshold: 50 },
  ai: DEFAULT_AI_CONFIG,
  cycleStatsConfig: { selectedModels: [] },
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
        if (active) setSettings({ ...DEFAULT_SETTINGS, ...data, ai: data.ai || DEFAULT_AI_CONFIG });
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

  const updateAI = useCallback(async (config: Partial<AIConfig>) => {
    await updateSettings({ ai: config });
  }, [updateSettings]);

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, ai: settings.ai, updateAI, loading }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
