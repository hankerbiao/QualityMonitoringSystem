import { API_BASE_URL } from '../constants';
import { apiFetch } from './authApi';
import type { SettingsResponse, ProcessRecordConfig, ProcessRecordConnectionTest, SettingsUpdate } from '../types';

export interface ApiResponse<T> {
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

  async updateAll(data: SettingsUpdate): Promise<SettingsResponse> {
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

};
