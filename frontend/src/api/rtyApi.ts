import { DefectDetail, RTYData, RTYFilterParams, SalesOrderSummary, PaginatedRTYResponse, PaginatedExcludedOrdersResponse, StationPassDetail, StationPassQuery, StationPassRate } from '../types';
import { apiFetch } from './authApi';

const RTY_LIST_CACHE_TTL_MS = 2_000;
const rtyListCache = new Map<string, { expiresAt: number; promise: Promise<PaginatedRTYResponse> }>();
const rtyListInFlight = new Map<string, Promise<PaginatedRTYResponse>>();
const RTY_OPTIONS_CACHE_TTL_MS = 5 * 60 * 60 * 1_000;
const RTY_CYCLE_CACHE_STORAGE_PREFIX = 'qualiboard:rty-cycle-data:';
const rtyOptionsCache = new Map<string, { expiresAt: number; promise: Promise<unknown> }>();
const rtyCycleCache = new Map<string, {
  expiresAt: number;
  promise: Promise<RTYData[]>;
  cachedAt: number;
}>();

/** Clear transient dashboard data after a user explicitly requests refresh. */
export function clearRtyApiCache(): void {
  rtyListCache.clear();
  rtyListInFlight.clear();
  rtyOptionsCache.clear();
  rtyCycleCache.clear();
}

export type CycleDataResult = {
  data: RTYData[];
  cached: boolean;
  cachedAt: number;
};

type StoredCycleData = {
  expiresAt: number;
  cachedAt: number;
  data: RTYData[];
};

function getStoredCycleData(key: string): StoredCycleData | null {
  try {
    const raw = window.localStorage.getItem(`${RTY_CYCLE_CACHE_STORAGE_PREFIX}${key}`);
    if (!raw) return null;

    const cached = JSON.parse(raw) as StoredCycleData;
    if (!Array.isArray(cached.data) || cached.expiresAt <= Date.now()) {
      window.localStorage.removeItem(`${RTY_CYCLE_CACHE_STORAGE_PREFIX}${key}`);
      return null;
    }
    return cached;
  } catch {
    return null;
  }
}

function setStoredCycleData(key: string, value: StoredCycleData): void {
  try {
    window.localStorage.setItem(`${RTY_CYCLE_CACHE_STORAGE_PREFIX}${key}`, JSON.stringify(value));
  } catch {
    // Caching is an optimization; quota or privacy restrictions must not block RTY data.
  }
}

function removeStoredCycleData(key: string): void {
  try {
    window.localStorage.removeItem(`${RTY_CYCLE_CACHE_STORAGE_PREFIX}${key}`);
  } catch {
    // The in-memory cache can still be invalidated when storage is unavailable.
  }
}

function cachedOption<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const cached = rtyOptionsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise as Promise<T>;
  const promise = loader().catch(error => {
    rtyOptionsCache.delete(key);
    throw error;
  });
  rtyOptionsCache.set(key, { expiresAt: Date.now() + RTY_OPTIONS_CACHE_TTL_MS, promise });
  return promise;
}

function buildRtyQuery(params: RTYFilterParams): URLSearchParams {
  const qs = new URLSearchParams();
  if (params.dateRange.from) qs.set('dateFrom', params.dateRange.from.toISOString().split('T')[0]);
  if (params.dateRange.to) qs.set('dateTo', params.dateRange.to.toISOString().split('T')[0]);
  if (params.productModel && params.productModel !== 'all') qs.set('productModel', params.productModel);
  if (params.customer) qs.set('customer', params.customer);
  if (params.base && params.base !== 'all') qs.set('base', params.base);
  if (params.salesOrder) qs.set('salesOrder', params.salesOrder);
  if (params.productionOrder) qs.set('productionOrder', params.productionOrder);
  if (params.serialNumber) qs.set('serialNumber', params.serialNumber);
  qs.set('orderScope', params.orderScope);
  if (params.calculationMethod) qs.set('calculationMethod', params.calculationMethod);
  return qs;
}

function buildStationPassQuery(params: StationPassQuery): URLSearchParams {
  const qs = new URLSearchParams({ groupBy: params.groupBy });
  if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
  if (params.dateTo) qs.set('dateTo', params.dateTo);
  if (params.serialNumber) qs.set('serialNumber', params.serialNumber);
  if (params.productModel) qs.set('productModel', params.productModel);
  if (params.base) qs.set('base', params.base);
  if (params.dimensionValue) qs.set('dimensionValue', params.dimensionValue);
  return qs;
}

export const rtyApi = {
  async getStationPassRates(params: StationPassQuery): Promise<StationPassRate[]> {
    const query = buildStationPassQuery(params);
    const suffix = query.toString();
    return cachedOption(`station-pass-rates:${suffix}`, async () => {
      const res = await apiFetch(`/api/rty/station-pass-rates${suffix ? `?${suffix}` : ''}`);
      const json = await res.json();
      if (!res.ok || !json.success || !Array.isArray(json.data)) {
        throw new Error(json.error || json.message || '工位过站数据加载失败');
      }
      return json.data as StationPassRate[];
    });
  },

  async getStationPassDetails(stationCode: string, params: StationPassQuery, detailType: 'input' | 'defect' = 'input'): Promise<StationPassDetail[]> {
    const qs = buildStationPassQuery(params);
    qs.set('stationCode', stationCode);
    qs.set('detailType', detailType);
    const res = await apiFetch(`/api/rty/station-pass-details?${qs}`);
    const json = await res.json();
    if (!res.ok || !json.success || !Array.isArray(json.data)) throw new Error(json.error || json.message || '工位明细加载失败');
    return json.data as StationPassDetail[];
  },

  async getCycleData(
    orderScope: RTYFilterParams['orderScope'] = 'normal',
    customer?: string,
    options: { forceRefresh?: boolean } = {},
  ): Promise<CycleDataResult> {
    const key = `cycle-data:${orderScope}:${customer || ''}`;
    if (options.forceRefresh) {
      rtyCycleCache.delete(key);
      removeStoredCycleData(key);
    }

    const cached = rtyCycleCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return { data: await cached.promise, cached: true, cachedAt: cached.cachedAt };
    }

    const stored = getStoredCycleData(key);
    if (stored) {
      rtyCycleCache.set(key, {
        expiresAt: stored.expiresAt,
        promise: Promise.resolve(stored.data),
        cachedAt: stored.cachedAt,
      });
      return { data: stored.data, cached: true, cachedAt: stored.cachedAt };
    }

    const promise = (async () => {
      const qs = new URLSearchParams({ orderScope });
      if (customer) qs.set('customer', customer);
      const res = await apiFetch(`/api/rty/cycle-data?${qs.toString()}`);
      const json = await res.json();
      if (!json.success || !Array.isArray(json.data)) {
        throw new Error(json.error || json.message || '周期统计数据加载失败');
      }
      return json.data as RTYData[];
    })();
    const entry = { expiresAt: Date.now() + RTY_OPTIONS_CACHE_TTL_MS, promise, cachedAt: Date.now() };
    rtyCycleCache.set(key, entry);
    void promise.then((data) => setStoredCycleData(key, { ...entry, data }));
    void promise.catch(() => {
      if (rtyCycleCache.get(key)?.promise === promise) rtyCycleCache.delete(key);
    });
    return { data: await promise, cached: false, cachedAt: entry.cachedAt };
  },

  async getRTYData(params: RTYFilterParams, page = 1, pageSize = 50): Promise<PaginatedRTYResponse> {
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('limit', String(pageSize));
    buildRtyQuery(params).forEach((value, key) => qs.set(key, value));

    const requestKey = qs.toString();
    const inFlight = rtyListInFlight.get(requestKey);
    if (inFlight) return inFlight;
    const cached = rtyListCache.get(requestKey);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;

    const promise = apiFetch(`/api/rty/list?${requestKey}`)
      .then(res => res.json() as Promise<PaginatedRTYResponse>)
      .then(json => {
        rtyListCache.set(requestKey, { expiresAt: Date.now() + RTY_LIST_CACHE_TTL_MS, promise });
        return json;
      })
      .catch(error => {
        rtyListCache.delete(requestKey);
        throw error;
      });
    rtyListInFlight.set(requestKey, promise);
    void promise.then(
      () => rtyListInFlight.delete(requestKey),
      () => rtyListInFlight.delete(requestKey),
    );
    return promise;
  },

  async getExcludedOrders(
    params: RTYFilterParams,
    page = 1,
    pageSize = 50,
  ): Promise<PaginatedExcludedOrdersResponse> {
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('limit', String(pageSize));
    buildRtyQuery(params).forEach((value, key) => qs.set(key, value));
    const res = await apiFetch(`/api/rty/excluded-orders?${qs}`);
    const json = await res.json();
    if (!res.ok || !Array.isArray(json.items)) {
      throw new Error(json.error || json.detail || '已过滤订单加载失败');
    }
    return json as PaginatedExcludedOrdersResponse;
  },

  async getDefectDetails(serialNumbers: string[]): Promise<DefectDetail[]> {
    if (!serialNumbers.length) return [];
    const qs = new URLSearchParams({ sns: serialNumbers.join(',') });
    const res = await apiFetch(`/api/rty/defects?${qs}`);
    const json = await res.json();
    return json.success ? json.data : [];
  },

  async getDefectDetailsByOrder(productionOrder: string): Promise<DefectDetail[]> {
    const qs = new URLSearchParams({ productionOrder });
    const res = await apiFetch(`/api/rty/defects/by-order?${qs}`);
    const json = await res.json();
    return json.success ? json.data : [];
  },

  async getDefectDetailsByFilters(params: RTYFilterParams): Promise<DefectDetail[]> {
    const qs = buildRtyQuery(params);

    const res = await apiFetch(`/api/rty/defects/by-filters?${qs}`);
    const json = await res.json();
    return json.success ? json.data : [];
  },

  async getSalesOrderSummary(salesOrders: string[]): Promise<SalesOrderSummary[]> {
    if (!salesOrders.length) return [];
    const qs = new URLSearchParams({ salesOrders: salesOrders.join(',') });
    const res = await apiFetch(`/api/rty/sales-order-summary?${qs}`);
    const json = await res.json();
    return json.success ? json.data : [];
  },

  async getProductModels(orderScope: RTYFilterParams['orderScope'] = 'normal'): Promise<{ model: string; count: number }[]> {
    return cachedOption(`product-models:${orderScope}`, async () => {
      const res = await apiFetch(`/api/rty/product-models?orderScope=${orderScope}`);
      const json = await res.json();
      return json.success ? json.data : [];
    });
  },

  async getBases(orderScope: RTYFilterParams['orderScope'] = 'normal'): Promise<{ base: string; count: number }[]> {
    return cachedOption(`bases:${orderScope}`, async () => {
      const res = await apiFetch(`/api/rty/bases?orderScope=${orderScope}`);
      const json = await res.json();
      return json.success ? json.data : [];
    });
  },

  async getCustomers(orderScope: RTYFilterParams['orderScope'] = 'normal'): Promise<string[]> {
    return cachedOption(`customers:${orderScope}`, async () => {
      const res = await apiFetch(`/api/rty/customers?orderScope=${orderScope}`);
      const json = await res.json();
      return json.success ? json.data : [];
    });
  },

  async getFilterOptions(orderScope: RTYFilterParams['orderScope'] = 'normal'): Promise<{
    productModels: { model: string; count: number }[];
    bases: { base: string; count: number }[];
    customers: string[];
  }> {
    return cachedOption(`filter-options:${orderScope}`, async () => {
      const res = await apiFetch(`/api/rty/filter-options?orderScope=${orderScope}`);
      const json = await res.json();
      return json.success
        ? json.data
        : { productModels: [], bases: [], customers: [] };
    });
  },

};
