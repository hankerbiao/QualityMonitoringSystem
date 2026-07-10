export interface MESConfig {
  username: string;
  password: string;
  hasPassword?: boolean;
}

export interface ModelTargets {
  [model: string]: number;
}

export interface EmailAlertConfig {
  enabled: boolean;
  emails: string;
  attachReport: boolean;
}

export interface AIConfig {
  apiUrl: string;
  modelId: string;
  apiKey: string;
  hasApiKey: boolean;
  maxTokens: number;
}

export interface SettingsResponse {
  mes: MESConfig | null;
  modelTargets: ModelTargets;
  emailAlert: EmailAlertConfig;
  featureFlags: { voiceInputEnabled: boolean };
  ai: AIConfig;
}

export const DEFAULT_AI_CONFIG: AIConfig = {
  apiUrl: '',
  modelId: '',
  apiKey: '',
  hasApiKey: false,
  maxTokens: 4096,
};

// 不再硬编码兜底目标率：目标直通率由后端按 configs.model_targets 提供，未配置默认 100。
// 保留空对象，避免开发者误把这些假值当成真实配置。
export const DEFAULT_MODEL_TARGETS: ModelTargets = {};

export interface SettingsContextType {
  ai: AIConfig;
  updateAI: (config: Partial<AIConfig>) => Promise<void>;
  loading: boolean;
}

export interface ModelTargetsContextType {
  modelTargets: ModelTargets;
  setModelTargets: (targets: ModelTargets) => void;
  loading: boolean;
}