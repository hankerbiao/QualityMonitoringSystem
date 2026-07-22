import type {
  LRRFilters,
  LRRFaultDetail,
  LRRListResponse,
  LRROptions,
} from '../types';
import { apiFetch } from './authApi';

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
    const res = await apiFetch(`/api/lrr/list${qs}`);
    return (await res.json()) as LRRListResponse;
  },

  /** 过滤器下拉枚举 */
  async getOptions(): Promise<LRROptions> {
    const res = await apiFetch('/api/lrr/options');
    return (await res.json()) as LRROptions;
  },

  /** 故障明细(用于导出)，返回全量命中记录 */
  async getFaultDetails(filters: LRRFilters = {}, limit = 20000): Promise<LRRFaultDetail[]> {
    const qs = buildQuery(filters, { limit });
    const res = await apiFetch(`/api/lrr/fault-details${qs}`);
    return (await res.json()) as LRRFaultDetail[];
  },
};

export type { LRRFilters, LRRFaultDetail, LRRListResponse, LRROptions };
