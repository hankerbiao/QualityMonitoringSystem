import { apiFetch } from './authApi';
import type { MetadataTableResponse } from '../types/metadata';

export const metadataApi = {
  async getTable(tableName: string, page = 1, pageSize = 25, search = ''): Promise<MetadataTableResponse> {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (search.trim()) params.set('search', search.trim());
    const response = await apiFetch(`/api/metadata/tables/${encodeURIComponent(tableName)}?${params}`);
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.detail || '表数据加载失败');
    }
    return (await response.json()) as MetadataTableResponse;
  },
};
