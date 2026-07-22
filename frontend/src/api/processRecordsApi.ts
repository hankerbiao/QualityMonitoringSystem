import { API_BASE_URL } from '../constants';
import type { ProcessRecordRealtimeData, ProcessRecordSource } from '../types';
import { apiFetch } from './authApi';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export const processRecordsApi = {
  async getRealtime(params: {
    source: ProcessRecordSource;
    sn?: string;
    page?: number;
    pageSize?: number;
  }): Promise<ProcessRecordRealtimeData> {
    const query = new URLSearchParams({
      source: params.source,
      page: String(params.page ?? 1),
      pageSize: String(params.pageSize ?? 30),
    });
    if (params.sn) query.set('sn', params.sn);
    const response = await apiFetch(`${API_BASE_URL}/process-records/realtime?${query}`);
    const json: ApiResponse<ProcessRecordRealtimeData> = await response.json();
    if (!response.ok || !json.success || !json.data) {
      throw new Error(json.error || json.message || '实时数据查询失败');
    }
    return json.data;
  },

  imageUrl(source: 'system1' | 'system2', path: string): string {
    const query = new URLSearchParams({ source, path });
    return `${API_BASE_URL}/process-records/image?${query}`;
  },
};
