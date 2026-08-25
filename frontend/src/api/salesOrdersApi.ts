import { apiFetch } from './authApi';
import type {
  SalesOrdersQueryResponse,
  SalesOrderFilterParams,
  SalesOrderSyncResult,
} from '../types/salesOrders';

function buildQuery(params: SalesOrderFilterParams, extra: Record<string, string> = {}): URLSearchParams {
  const qs = new URLSearchParams();
  params.cpXh.forEach((value) => qs.append('cp_xh', value));
  params.lgort.forEach((value) => qs.append('lgort', value));
  if (params.dateFrom) qs.set('date_from', params.dateFrom);
  if (params.dateTo) qs.set('date_to', params.dateTo);
  if (params.keyword.trim()) qs.set('keyword', params.keyword.trim());
  Object.entries(extra).forEach(([key, value]) => qs.set(key, value));
  return qs;
}

export const EMPTY_FILTERS: SalesOrderFilterParams = {
  cpXh: [],
  lgort: [],
  dateFrom: '',
  dateTo: '',
  keyword: '',
};

export const salesOrdersApi = {
  /** Fetch page, stats, and filter options in one request. */
  async query(
    params: SalesOrderFilterParams,
    page = 1,
    limit = 20,
  ): Promise<SalesOrdersQueryResponse> {
    const qs = buildQuery(params, { page: String(page), limit: String(limit) });
    const res = await apiFetch(`/api/sales-orders/query?${qs}`);
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new Error(payload?.detail || '销售订单加载失败');
    }
    return (await res.json()) as SalesOrdersQueryResponse;
  },

  /** 按排产日期范围从 SG / KK 两个 SAP 来源同步销售订单（默认按产品层次 00100 过滤） */
  async sync(startDate: string, endDate: string, prodhList: string[] = ['00100']): Promise<SalesOrderSyncResult> {
    const res = await apiFetch('/api/sales-orders/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_date: startDate, end_date: endDate, prodh_list: prodhList }),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      const detail = payload?.detail;
      if (typeof detail === 'string') throw new Error(detail);
      if (detail?.message) throw new Error(detail.message);
      throw new Error(`同步失败（HTTP ${res.status}）`);
    }
    return (await res.json()) as SalesOrderSyncResult;
  },
};
