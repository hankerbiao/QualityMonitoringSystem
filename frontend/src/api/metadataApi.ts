import { requestJson } from './authApi';
import type { MetadataTableResponse } from '../types/metadata';

export const metadataApi = {
  async getTable(
    tableName: string,
    page = 1,
    pageSize = 25,
    search = '',
    filters: Record<string, string> = {},
  ): Promise<MetadataTableResponse> {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (search.trim()) params.set('search', search.trim());
    Object.entries(filters).forEach(([key, value]) => {
      if (value.trim()) params.set(key, value.trim());
    });
    return requestJson<MetadataTableResponse>(`/api/metadata/tables/${encodeURIComponent(tableName)}?${params}`);
  },
};
