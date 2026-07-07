import { createContext, useContext, useState, useCallback } from 'react';

interface AIConfig {
  enabled: boolean;
  apiUrl: string;
  modelId: string;
  apiKey: string;
  maxTokens: number;
}

interface Settings {
  voiceInputEnabled: boolean;
  ai: AIConfig;
}

interface SettingsContextType {
  settings: Settings;
  updateSettings: (settings: Partial<Settings>) => void;
  updateAI: (config: Partial<AIConfig>) => void;
}

const DEFAULT_SETTINGS: Settings = {
  voiceInputEnabled: false,
  ai: {
    enabled: false,
    apiUrl: '',
    modelId: '',
    apiKey: '',
    maxTokens: 4096,
  },
};

const STORAGE_KEY = 'quality_monitoring_settings';

function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  const updateSettings = useCallback((newSettings: Partial<Settings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {
        console.warn('Failed to persist settings');
      }
      return updated;
    });
  }, []);

  const updateAI = useCallback((config: Partial<AIConfig>) => {
    updateSettings({ ai: { ...settings.ai, ...config } });
  }, [settings.ai, updateSettings]);

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, updateAI }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}