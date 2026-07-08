import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { settingsApi } from '../api/settingsApi';
import { useAuth } from './AuthContext';

const DEFAULT_TARGETS: Record<string, number> = {
  '6210 C21 BOX': 99.0,
  '6210 C21': 99.0,
  '6210 C31': 99.0,
  '普通机型': 99.0,
};

interface ModelTargetsContextType {
  modelTargets: Record<string, number>;
  setModelTargets: (targets: Record<string, number>) => void;
  loading: boolean;
}

const ModelTargetsContext = createContext<ModelTargetsContextType | undefined>(undefined);

export function ModelTargetsProvider({ children }: { children: ReactNode }) {
  const { isAuthLoaded } = useAuth();
  const [modelTargets, setModelTargets] = useState<Record<string, number>>(DEFAULT_TARGETS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthLoaded) return;
    settingsApi.getModelTargets()
      .then((items) => {
        if (Object.keys(items).length > 0) {
          setModelTargets(items);
        }
      })
      .catch((err) => {
        console.error('[ModelTargets] Failed to load from backend:', err);
      })
      .finally(() => setLoading(false));
  }, [isAuthLoaded]);

  return (
    <ModelTargetsContext.Provider value={{ modelTargets, setModelTargets, loading }}>
      {children}
    </ModelTargetsContext.Provider>
  );
}

export function useModelTargets() {
  const ctx = useContext(ModelTargetsContext);
  if (!ctx) throw new Error('useModelTargets must be used within ModelTargetsProvider');
  return ctx;
}