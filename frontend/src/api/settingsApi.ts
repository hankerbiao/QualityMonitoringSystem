import { API_BASE_URL } from '../constants';
import { requestData } from './authApi';
import type { SettingsResponse, ProcessRecordConfig, ProcessRecordConnectionTest, SettingsUpdate } from '../types';
import type { HomeModuleStatus } from '../config/homeModules';

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
  async getAll(): Promise<SettingsResponse> {
    return requestData<SettingsResponse>(`${API_BASE_URL}/settings`);
  },

  async updateAll(data: SettingsUpdate): Promise<SettingsResponse> {
    return requestData<SettingsResponse>(`${API_BASE_URL}/settings`, {
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


  async testEmail(emails: string): Promise<{ sent: boolean; recipients?: string[]; reason?: string }> {
    return requestData<{ sent: boolean; recipients?: string[]; reason?: string }>(`${API_BASE_URL}/alert-report/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails }),
    });
  },

  async getWeeklyQualifiedModels(threshold: number): Promise<WeeklyQualifiedModels> {
    return requestData<WeeklyQualifiedModels>(`${API_BASE_URL}/settings/email-alert/qualified-models?threshold=${threshold}`);
  },

};
