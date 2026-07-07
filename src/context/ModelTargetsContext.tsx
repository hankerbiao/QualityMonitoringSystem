import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

const DEFAULT_TARGETS: Record<string, number> = {
  '6210 C21 BOX': 99.0,
  '6210 C21': 99.0,
  '6210 C31': 99.0,
  '普通机型': 99.0,
};

interface ModelTargetsContextType {
  modelTargets: Record<string, number>;
  setModelTargets: (targets: Record<string, number>) => void;
}

const ModelTargetsContext = createContext<ModelTargetsContextType | undefined>(undefined);

export function ModelTargetsProvider({ children }: { children: ReactNode }) {
  const [modelTargets, setModelTargets] = useState<Record<string, number>>(DEFAULT_TARGETS);
  return (
    <ModelTargetsContext.Provider value={{ modelTargets, setModelTargets }}>
      {children}
    </ModelTargetsContext.Provider>
  );
}

export function useModelTargets() {
  const ctx = useContext(ModelTargetsContext);
  if (!ctx) throw new Error('useModelTargets must be used within ModelTargetsProvider');
  return ctx;
}
