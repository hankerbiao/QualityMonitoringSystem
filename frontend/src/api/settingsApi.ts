import { API_BASE_URL } from '../constants';
import { apiFetch } from './authApi';
import type { MESConfig, ModelTargets, EmailAlertConfig, AIConfig, SettingsResponse, RTYDataDictionary, DimensionValues, CycleStatsConfig, DataSummary, ProcessRecordConfig, ProcessRecordConnectionTest } from '../types';

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
    processRecords?: Partial<ProcessRecordConfig>;
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

  async testProcessRecords(config: Partial<ProcessRecordConfig>): Promise<ProcessRecordConnectionTest> {
    const res = await apiFetch(`${API_BASE_URL}/settings/process-records/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: config.username, password: config.password }),
    });
    const json: ApiResponse<ProcessRecordConnectionTest> = await res.json();
    if (!json.data) throw new Error(json.message || '数据源连接测试失败');
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

  async testEmail(emails: string): Promise<{ sent: boolean; recipients?: string[]; reason?: string }> {
    const res = await apiFetch(`${API_BASE_URL}/alert-report/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails }),
    });
    const json: ApiResponse<{ sent: boolean; recipients?: string[]; reason?: string }> = await res.json();
    if (!json.success) throw new Error(json.message || '测试邮件发送失败');
    return json.data;
  },

  async getRTYDataDictionary(): Promise<RTYDataDictionary> {
    const res = await apiFetch(`${API_BASE_URL}/settings/rty-dictionary`);
    const json: ApiResponse<RTYDataDictionary> = await res.json();
    if (!json.success) throw new Error(json.message || 'Failed to fetch RTY data dictionary');
    return json.data;
  },

  async getRTYDimensionValues(
    field: string,
    search = '',
    page = 1,
    pageSize = 50,
  ): Promise<DimensionValues> {
    const params = new URLSearchParams({ field, search, page: String(page), pageSize: String(pageSize) });
    const res = await apiFetch(`${API_BASE_URL}/settings/rty-dictionary/dimension?${params.toString()}`);
    const json: ApiResponse<DimensionValues> = await res.json();
    if (!json.success) throw new Error(json.message || 'Failed to fetch dimension values');
    return json.data;
  },

  async getCycleStatsConfig(): Promise<CycleStatsConfig> {
    const res = await apiFetch(`${API_BASE_URL}/settings/cycle-stats-config`);
    const json: ApiResponse<CycleStatsConfig> = await res.json();
    if (!json.success) throw new Error(json.message || 'Failed to fetch cycle stats config');
    return json.data;
  },

  async saveCycleStatsConfig(config: CycleStatsConfig): Promise<CycleStatsConfig> {
    const res = await apiFetch(`${API_BASE_URL}/settings/cycle-stats-config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    const json: ApiResponse<CycleStatsConfig> = await res.json();
    if (!json.success) throw new Error(json.message || 'Failed to save cycle stats config');
    return json.data;
  },

  async getDataSummary(): Promise<DataSummary> {
    const res = await apiFetch(`${API_BASE_URL}/settings/summary`);
    const json: ApiResponse<DataSummary> = await res.json();
    if (!json.success) throw new Error(json.message || 'Failed to fetch data summary');
    return json.data;
  },
};
