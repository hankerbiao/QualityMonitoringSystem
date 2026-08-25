import { createContext, useContext, useState, type ReactNode } from 'react';
import { useSettings } from './SettingsContext';
import type { ModelTargets, ModelTargetsContextType } from '../types';
import { DEFAULT_MODEL_TARGETS } from '../types';

const ModelTargetsContext = createContext<ModelTargetsContextType | undefined>(undefined);

export function ModelTargetsProvider({ children }: { children: ReactNode }) {
  const { settings, loading } = useSettings();
  const [localTargets, setLocalTargets] = useState<ModelTargets | null>(null);
  const modelTargets = localTargets ?? settings.modelTargets ?? DEFAULT_MODEL_TARGETS;

  return (
    <ModelTargetsContext.Provider value={{ modelTargets, setModelTargets: setLocalTargets, loading }}>
      {children}
    </ModelTargetsContext.Provider>
  );
}

export function useModelTargets() {
  const ctx = useContext(ModelTargetsContext);
  if (!ctx) throw new Error('useModelTargets must be used within ModelTargetsProvider');
  return ctx;
}
