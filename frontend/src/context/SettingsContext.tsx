import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { settingsApi } from '../api/settingsApi';
import { useAuth } from './AuthContext';
import type { AIConfig, SettingsContextType } from '../types';
import { DEFAULT_AI_CONFIG } from '../types';

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { isAuthLoaded } = useAuth();
  const [ai, setAI] = useState<AIConfig>(DEFAULT_AI_CONFIG);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthLoaded) return;
    settingsApi.getAll()
      .then((data) => {
        const aiConfig = data.ai || DEFAULT_AI_CONFIG;
        if (aiConfig.hasApiKey && !aiConfig.apiKey) {
          const cached = localStorage.getItem('ai_api_key');
          if (cached) aiConfig.apiKey = cached;
        }
        setAI(aiConfig);
      })
      .catch((err) => {
        console.error('[Settings] Failed to load from backend:', err);
      })
      .finally(() => setLoading(false));
  }, [isAuthLoaded]);

  const updateAI = useCallback(async (config: Partial<AIConfig>) => {
    const updated = { ...ai, ...config };
    setAI(updated);
    if (config.apiKey) {
      localStorage.setItem('ai_api_key', config.apiKey);
    }
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