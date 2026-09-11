import { API_BASE_URL } from '../constants';
import type {
  ProcessRecordFilterOptions,
  ProcessRecordRealtimeData,
  ProcessRecordSource,
} from '../types';
import { requestData } from './authApi';

export const processRecordsApi = {
  async getRealtime(params: {
    source: ProcessRecordSource;
    sn?: string;
    base?: string;
    station?: string;
    page?: number;
    pageSize?: number;
  }): Promise<ProcessRecordRealtimeData> {
    const query = new URLSearchParams({
      source: params.source,
      page: String(params.page ?? 1),
      pageSize: String(params.pageSize ?? 30),
    });
    if (params.sn) query.set('sn', params.sn);
    if (params.base) query.set('base', params.base);
    if (params.station) query.set('station', params.station);
    return requestData<ProcessRecordRealtimeData>(`${API_BASE_URL}/process-records/realtime?${query}`);
  },

  async getFilterOptions(): Promise<ProcessRecordFilterOptions> {
    return requestData<ProcessRecordFilterOptions>(`${API_BASE_URL}/process-records/filter-options`);
  },

  imageUrl(source: 'system1' | 'system2', path: string): string {
    const query = new URLSearchParams({ source, path });
    return `${API_BASE_URL}/process-records/image?${query}`;
  },
};
