import { API_BASE_URL } from '../constants';
import { requestData, requestJson, type ApiEnvelope } from './authApi';
import type { AccessibleSettingsResponse, ProcessRecordConfig, ProcessRecordConnectionTest, SettingsUpdate } from '../types';
import type { HomeModuleStatus } from '../config/homeModules';

export interface TestEmailResult {
  sent: boolean;
  recipients?: string[];
  reason?: string;
  error?: string;
}

export interface WeeklyQualifiedModels {
  window: { from: string; to: string };
  threshold: number;
  modelsChecked: number;
  details: Array<{
    productModel: string;
    inputCount: number;
    defectCount: number;
    rtyRate: number;
    targetRate: number;
  }>;
}

export const settingsApi = {
  async getModelTargetSourceModels(): Promise<string[]> {
    return requestData<string[]>(`${API_BASE_URL}/settings/model-targets/models`);
  },

  async getAll(): Promise<AccessibleSettingsResponse> {
    return requestData<AccessibleSettingsResponse>(`${API_BASE_URL}/settings`);
  },

  async updateAll(data: SettingsUpdate): Promise<AccessibleSettingsResponse> {
    return requestData<AccessibleSettingsResponse>(`${API_BASE_URL}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },

  async getDashboardStatuses(): Promise<Record<string, HomeModuleStatus>> {
    return requestData<Record<string, HomeModuleStatus>>(`${API_BASE_URL}/settings/dashboard-statuses`);
  },

  async testProcessRecords(config: Partial<ProcessRecordConfig>): Promise<ProcessRecordConnectionTest> {
    return requestData<ProcessRecordConnectionTest>(`${API_BASE_URL}/settings/process-records/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: config.username, password: config.password }),
    });
  },


  async testEmail(emails: string): Promise<TestEmailResult> {
    const payload = await requestJson<ApiEnvelope<TestEmailResult>>(`${API_BASE_URL}/alert-report/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails }),
    });
    if (!payload?.data) {
      throw new Error(payload?.error || payload?.message || '测试邮件返回数据无效');
    }
    return payload.data;
  },

  async getWeeklyQualifiedModels(threshold: number): Promise<WeeklyQualifiedModels> {
    return requestData<WeeklyQualifiedModels>(`${API_BASE_URL}/settings/email-alert/qualified-models?threshold=${threshold}`);
  },

};
