import type {
  LRRFilters,
  LRRData,
  LRRFaultDetail,
  LRRFaultDetailsResponse,
  LRRListResponse,
  LRROptions,
} from '../types';
import { requestJson } from './authApi';

const inFlightRequests = new Map<string, Promise<unknown>>();
const LRR_PAGE_LIMIT = 500;

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
    if (k === 'customerIds' && Array.isArray(v)) {
      v.forEach((customerId) => qs.append('customerId', customerId));
      continue;
    }
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export const lrrApi = {
  /** 获取 LRR 列表 + 多维统计聚合 */
  async getLRRData(
    page = 1,
    pageSize = 50,
    filters: LRRFilters = {},
    signal?: AbortSignal,
  ): Promise<LRRListResponse> {
    const qs = buildQuery(filters, { page, limit: pageSize });
    const url = `/api/lrr/list${qs}`;
    return requestJson<LRRListResponse>(url, { signal });
  },

  /** 获取筛选条件下的全部物料月度行 */
  async getAllLRRData(filters: LRRFilters = {}): Promise<LRRData[]> {
    const firstPage = await this.getLRRData(1, LRR_PAGE_LIMIT, filters);
    const items = [...firstPage.items];
    const totalPages = Math.ceil(firstPage.total / LRR_PAGE_LIMIT);
    for (let page = 2; page <= totalPages; page += 1) {
      const result = await this.getLRRData(page, LRR_PAGE_LIMIT, filters);
      items.push(...result.items);
    }
    if (items.length < firstPage.total) {
      throw new Error('物料 PN 明细分页数据不完整，请重试导出');
    }
    return items.slice(0, firstPage.total);
  },

  /** 过滤器下拉枚举 */
  async getOptions(): Promise<LRROptions> {
    const url = '/api/lrr/options';
    return requestOnce(url, async () => {
      return requestJson<LRROptions>(url);
    });
  },

  /** 故障明细(用于导出)，返回全量命中记录 */
  async getFaultDetails(filters: LRRFilters = {}, limit = 50000): Promise<LRRFaultDetailsResponse> {
    const qs = buildQuery(filters, { limit });
    return requestJson<LRRFaultDetailsResponse>(`/api/lrr/fault-details${qs}`);
  },
};

export type { LRRFilters, LRRFaultDetail, LRRFaultDetailsResponse, LRRListResponse, LRROptions };
