import type {
  LRRFilters,
  LRRFaultDetail,
  LRRFaultDetailsResponse,
  LRRListResponse,
  LRROptions,
} from '../types';
import { apiFetch } from './authApi';

const inFlightRequests = new Map<string, Promise<unknown>>();

function requestOnce<T>(url: string, request: () => Promise<T>): Promise<T> {
  const inFlight = inFlightRequests.get(url) as Promise<T> | undefined;
  if (inFlight) return inFlight;

  const promise = request().finally(() => {
    inFlightRequests.delete(url);
  });
  inFlightRequests.set(url, promise);
  return promise;
}

function buildQuery(filters: LRRFilters, extra?: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  const params: Record<string, unknown> = { ...filters, ...extra };
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === 'all' || v === 'none') continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export const lrrApi = {
  /** 获取 LRR 列表 + 多维统计聚合 */
  async getLRRData(page = 1, pageSize = 50, filters: LRRFilters = {}): Promise<LRRListResponse> {
    const qs = buildQuery(filters, { page, limit: pageSize });
    const url = `/api/lrr/list${qs}`;
    return requestOnce(url, async () => {
      const res = await apiFetch(url);
      if (!res.ok) throw new Error('LRR 看板加载失败');
      return (await res.json()) as LRRListResponse;
    });
  },

  /** 过滤器下拉枚举 */
  async getOptions(): Promise<LRROptions> {
    const url = '/api/lrr/options';
    return requestOnce(url, async () => {
      const res = await apiFetch(url);
      if (!res.ok) throw new Error('LRR 筛选项加载失败');
      return (await res.json()) as LRROptions;
    });
  },

  /** 故障明细(用于导出)，返回全量命中记录 */
  async getFaultDetails(filters: LRRFilters = {}, limit = 50000): Promise<LRRFaultDetailsResponse> {
    const qs = buildQuery(filters, { limit });
    const res = await apiFetch(`/api/lrr/fault-details${qs}`);
    if (!res.ok) throw new Error('LRR 故障明细加载失败');
    return (await res.json()) as LRRFaultDetailsResponse;
  },
};

export type { LRRFilters, LRRFaultDetail, LRRFaultDetailsResponse, LRRListResponse, LRROptions };
