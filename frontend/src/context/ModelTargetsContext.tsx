import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { settingsApi } from '../api/settingsApi';
import { useAuth } from './AuthContext';
import type { ModelTargets, ModelTargetsContextType } from '../types';
import { DEFAULT_MODEL_TARGETS } from '../types';

const ModelTargetsContext = createContext<ModelTargetsContextType | undefined>(undefined);

export function ModelTargetsProvider({ children }: { children: ReactNode }) {
  const { isAuthLoaded } = useAuth();
  const [modelTargets, setModelTargets] = useState<ModelTargets>(DEFAULT_MODEL_TARGETS);
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