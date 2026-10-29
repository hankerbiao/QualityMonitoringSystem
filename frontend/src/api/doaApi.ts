import { requestJson } from './authApi';
import { API_BASE_URL } from '../constants';
import type { DoaAudit, DoaDashboard, DoaFilters, DoaOptions, DoaOrderItem, DoaOrdersResponse, DoaRawDashboard, DoaRawFilters, DoaRepairItem, DoaRepairsResponse } from '../types/doa';

function query(filters: DoaFilters, extra: Record<string, string | number> = {}) {
  const params = new URLSearchParams();
  Object.entries({ ...filters, ...extra }).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      [...new Set(value)].sort().forEach((item) => params.append(key, item));
    } else if (value !== '' && value !== undefined && value !== null) params.set(key, String(value));
  });
  return params.toString() ? `?${params.toString()}` : '';
}

export const doaApi = {
  async getOptions(): Promise<DoaOptions> {
    return requestJson<DoaOptions>(`${API_BASE_URL}/doa/options`);
  },
  async getDashboard(filters: DoaFilters): Promise<DoaDashboard> {
    return requestJson<DoaDashboard>(`${API_BASE_URL}/doa/dashboard${query(filters)}`);
  },
  async getAudit(filters: DoaFilters): Promise<DoaAudit> {
    return requestJson<DoaAudit>(`${API_BASE_URL}/doa/audit${query(filters)}`);
  },
  async getRepairs(filters: DoaFilters, page = 1, limit = 50, replacementOnly = false, unmatchedOnly = false): Promise<DoaRepairsResponse> {
    const extra: Record<string, string | number> = { page, limit };
    if (replacementOnly) extra.replacementOnly = 'true';
    if (unmatchedOnly) extra.unmatchedOnly = 'true';
    return requestJson<DoaRepairsResponse>(`${API_BASE_URL}/doa/repairs${query(filters, extra)}`);
  },
  async getOrders(filters: DoaFilters, page = 1, limit = 50): Promise<DoaOrdersResponse> {
    return requestJson<DoaOrdersResponse>(`${API_BASE_URL}/doa/orders${query(filters, { page, limit })}`);
  },
  async getAllOrders(filters: DoaFilters): Promise<DoaOrderItem[]> {
    const items: DoaOrderItem[] = [];
    let total: number | undefined;
    const limit = 1000;
    for (let page = 1; ; page++) {
      const result = await doaApi.getOrders(filters, page, limit);
      if (total !== undefined && result.total !== total) throw new Error('订单数据已变化，请重新导出');
      total = result.total;
      if (result.page !== page || result.items.length > limit || items.length + result.items.length > total || (items.length + result.items.length < total && result.items.length !== limit)) throw new Error('订单明细分页不完整，请重新导出');
      items.push(...result.items);
      if (items.length === total) return items;
    }
  },
  async getAllRepairs(filters: DoaFilters, replacementOnly = false, limit = 1000, unmatchedOnly = false): Promise<DoaRepairItem[]> {
    const items: DoaRepairItem[] = [];
    let total: number | undefined;
    for (let page = 1; ; page++) {
      const result = await doaApi.getRepairs(filters, page, limit, replacementOnly, unmatchedOnly);
      if (total !== undefined && result.total !== total) throw new Error('报修数据已变化，请重新导出');
      total = result.total;
      if (result.page !== page || result.items.length > limit || items.length + result.items.length > total || (items.length + result.items.length < total && result.items.length !== limit)) {
        throw new Error('报修明细分页不完整，请重新导出');
      }
      items.push(...result.items);
      if (items.length === total) return items;
    }
  },
  async getRaw(page = 1, limit = 50, filters: DoaRawFilters = {}): Promise<DoaRawDashboard> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return requestJson<DoaRawDashboard>(`${API_BASE_URL}/doa/raw?${params}`);
  },
  buildQuery(filters: DoaFilters, extra: Record<string, string | number> = {}) {
    return query(filters, extra).replace(/^\?/, '');
  },
};
