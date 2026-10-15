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
const completedRequests = new Map<string, { expiresAt: number; value: unknown }>();
const LRR_PAGE_LIMIT = 500;
const LRR_CACHE_TTL_MS = 5 * 60 * 1_000;
const LRR_CACHE_MAX_ENTRIES = 12;
let cacheGeneration = 0;

/** Clear the short-lived LRR result cache after an explicit data refresh. */
export function clearLrrApiCache(): void {
  cacheGeneration += 1;
  inFlightRequests.clear();
  completedRequests.clear();
}

function requestOnce<T>(url: string, request: () => Promise<T>): Promise<T> {
  const inFlight = inFlightRequests.get(url) as Promise<T> | undefined;
  if (inFlight) return inFlight;

  let promise: Promise<T>;
  promise = request().finally(() => {
    if (inFlightRequests.get(url) === promise) inFlightRequests.delete(url);
  });
  inFlightRequests.set(url, promise);
  return promise;
}

function storeCompletedRequest<T>(url: string, value: T, generation: number): void {
  if (generation !== cacheGeneration) return;
  const now = Date.now();
  for (const [key, cached] of completedRequests) {
    if (cached.expiresAt <= now) completedRequests.delete(key);
  }
  while (completedRequests.size >= LRR_CACHE_MAX_ENTRIES) {
    const oldestKey = completedRequests.keys().next().value;
    if (oldestKey === undefined) break;
    completedRequests.delete(oldestKey);
  }
  completedRequests.set(url, { expiresAt: now + LRR_CACHE_TTL_MS, value });
}

function cachedRequest<T>(url: string, request: () => Promise<T>): Promise<T> {
  const cached = completedRequests.get(url);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value as T);
  if (cached) completedRequests.delete(url);

  const generation = cacheGeneration;
  return requestOnce(url, async () => {
    const value = await request();
    storeCompletedRequest(url, value, generation);
    return value;
  });
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
    if (signal) {
      const generation = cacheGeneration;
      return requestJson<LRRListResponse>(url, { signal }).then((value) => {
        if (!signal.aborted) storeCompletedRequest(url, value, generation);
        return value;
      });
    }
    return cachedRequest(url, () => requestJson<LRRListResponse>(url, { signal }));
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
    const url = `/api/lrr/fault-details${qs}`;
    return cachedRequest(url, () => requestJson<LRRFaultDetailsResponse>(url));
  },
};

export type { LRRFilters, LRRFaultDetail, LRRFaultDetailsResponse, LRRListResponse, LRROptions };
