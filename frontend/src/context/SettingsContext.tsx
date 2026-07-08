import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { settingsApi, type AIConfig } from '../api/settingsApi';
import { useAuth } from './AuthContext';

interface SettingsContextType {
  ai: AIConfig;
  updateAI: (config: Partial<AIConfig>) => Promise<void>;
  loading: boolean;
}

const DEFAULT_AI: AIConfig = {
  apiUrl: '',
  modelId: '',
  apiKey: '',
  maxTokens: 4096,
};

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { isAuthLoaded } = useAuth();
  const [ai, setAI] = useState<AIConfig>(DEFAULT_AI);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthLoaded) return;
    settingsApi.getAll()
      .then((data) => {
        setAI(data.ai || DEFAULT_AI);
      })
      .catch((err) => {
        console.error('[Settings] Failed to load from backend:', err);
      })
      .finally(() => setLoading(false));
  }, [isAuthLoaded]);

  const updateAI = useCallback(async (config: Partial<AIConfig>) => {
    const updated = { ...ai, ...config };
    setAI(updated);
    await settingsApi.updateAI(config);
  }, [ai]);

  return (
    <SettingsContext.Provider value={{ ai, updateAI, loading }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}