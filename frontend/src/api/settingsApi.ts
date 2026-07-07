import { apiFetch } from './authApi';

const API_BASE_URL = '/api';

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
  maxTokens: number;
}

export interface SettingsResponse {
  mes: MESConfig | null;
  modelTargets: ModelTargets;
  emailAlert: EmailAlertConfig;
  featureFlags: { voiceInputEnabled: boolean };
  ai: AIConfig;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export const settingsApi = {
  async getAll(): Promise<SettingsResponse> {
    const res = await apiFetch(`${API_BASE_URL}/settings`);
    const json: ApiResponse<SettingsResponse> = await res.json();
    if (!json.success) throw new Error('Failed to fetch settings');
    return json.data;
  },

  async updateAll(data: {
    mes?: Partial<MESConfig>;
    modelTargets?: ModelTargets;
    emailAlert?: Partial<EmailAlertConfig>;
    ai?: Partial<AIConfig>;
  }): Promise<SettingsResponse> {
    const res = await apiFetch(`${API_BASE_URL}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json: ApiResponse<SettingsResponse> = await res.json();
    if (!json.success) throw new Error('Failed to update settings');
    return json.data;
  },

  async updateAI(config: Partial<AIConfig>): Promise<AIConfig> {
    const res = await apiFetch(`${API_BASE_URL}/settings/ai`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    const json: ApiResponse<AIConfig> = await res.json();
    if (!json.success) throw new Error('Failed to update AI config');
    return json.data;
  },

  async getModelTargets(): Promise<ModelTargets> {
    const res = await apiFetch(`${API_BASE_URL}/settings/model-targets`);
    const json: ApiResponse<{ items: ModelTargets }> = await res.json();
    if (!json.success) throw new Error('Failed to fetch model targets');
    return json.data.items;
  },

  async updateModelTargets(targets: ModelTargets): Promise<ModelTargets> {
    const res = await apiFetch(`${API_BASE_URL}/settings/model-targets`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(targets),
    });
    const json: ApiResponse<{ items: ModelTargets }> = await res.json();
    if (!json.success) throw new Error('Failed to update model targets');
    return json.data.items;
  },
};