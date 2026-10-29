import { DefectDetail, RTYData, RTYFilterParams, SalesOrderSummary, PaginatedRTYResponse, PaginatedExcludedOrdersResponse, RepairQualityOptions, RepairQualitySummary, StationPassDetail, StationPassQuery, StationPassRate } from '../types';
import { requestData, requestJson } from './authApi';
import { API_BASE_URL } from '../constants';
import type { RepairQualityDetailQuery, RepairQualityDetails, RepairQualityExport, RepairQualityQuery, RTYCycleDetails, RTYCycleDetailQuery, RTYTemplateExport, StationPassExport } from '../types/rty';
import type { UserProfile } from '../types/auth';

const RTY_LIST_CACHE_TTL_MS = 2_000;
const rtyListCache = new Map<string, { expiresAt: number; promise: Promise<PaginatedRTYResponse> }>();
const rtyListInFlight = new Map<string, Promise<PaginatedRTYResponse>>();
const RTY_OPTIONS_CACHE_TTL_MS = 5 * 60 * 60 * 1_000;
const RTY_CYCLE_CACHE_TTL_MS = 60 * 60 * 1_000;
const RTY_CYCLE_CACHE_STORAGE_PREFIX = 'qualiboard:rty-cycle-data:v2:';
const rtyOptionsCache = new Map<string, { expiresAt: number; promise: Promise<unknown> }>();
const rtyCycleCache = new Map<string, {
  expiresAt: number;
  promise: Promise<RTYData[]>;
  cachedAt: number;
}>();
let accessScope = '';

export function setRtyAccessScope(user: UserProfile | null): void {
  const next = user ? JSON.stringify([
    user.username || user.itcode,
    user.role,
    user.basePermissions ?? null,
    user.dashboardPermissions ?? [],
  ]) : '';
  if (next !== accessScope) {
    accessScope = next;
    clearRtyApiCache();
  }
}

function scopedKey(key: string): string {
  return accessScope ? `${accessScope}:${key}` : key;
}

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
    cached.expiresAt = Math.min(cached.expiresAt, cached.cachedAt + RTY_CYCLE_CACHE_TTL_MS);
    if (!Array.isArray(cached.data) || !Number.isFinite(cached.expiresAt) || cached.expiresAt <= Date.now()) {
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
  key = scopedKey(key);
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
  params.productModels?.forEach((value) => qs.append('productModels', value));
  if (params.customer) qs.set('customer', params.customer);
  params.customers?.forEach((value) => qs.append('customers', value));
  if (params.base && params.base !== 'all') qs.set('base', params.base);
  params.bases?.forEach((value) => qs.append('bases', value));
  if (params.salesOrder) qs.set('salesOrder', params.salesOrder);
  if (params.productionOrder) qs.set('productionOrder', params.productionOrder);
  if (params.serialNumber) qs.set('serialNumber', params.serialNumber);
  if (params.orderType) qs.set('orderType', params.orderType);
  params.orderTypes?.forEach(value => qs.append('orderTypes', value));
  qs.set('orderScope', params.orderScope);
  if (params.calculationMethod) qs.set('calculationMethod', params.calculationMethod);
  return qs;
}

function buildRepairQualityQuery(params: RepairQualityQuery): URLSearchParams {
  const qs = new URLSearchParams({ dateFrom: params.dateFrom, dateTo: params.dateTo });
  params.productModels?.forEach(value => qs.append('productModels', value));
  params.customers?.forEach(value => qs.append('customers', value));
  params.bases?.forEach(value => qs.append('bases', value));
  return qs;
}

function buildStationPassQuery(params: StationPassQuery): URLSearchParams {
  const qs = new URLSearchParams({ groupBy: params.groupBy, orderScope: params.orderScope || 'normal' });
  if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
  if (params.dateTo) qs.set('dateTo', params.dateTo);
  if (params.serialNumber) qs.set('serialNumber', params.serialNumber);
  params.productModels?.forEach((value) => qs.append('productModels', value));
  params.customers?.forEach((value) => qs.append('customers', value));
  params.bases?.forEach((value) => qs.append('bases', value));
  params.orderTypes?.forEach((value) => qs.append('orderTypes', value));
  if (params.productModel) qs.set('productModel', params.productModel);
  if (params.customer) qs.set('customer', params.customer);
  if (params.base) qs.set('base', params.base);
  if (params.dimensionValue) qs.set('dimensionValue', params.dimensionValue);
  if (params.overseas) qs.set('overseas', 'true');
  return qs;
}

export const rtyApi = {
  async getTemplateExport(params: RTYFilterParams): Promise<RTYTemplateExport> {
    return requestData<RTYTemplateExport>(`${API_BASE_URL}/rty/export?${buildRtyQuery(params)}`);
  },
  async getCycleExport(params: {
    dateFrom: string;
    dateTo: string;
    orderScope: RTYFilterParams['orderScope'];
    customer?: string;
    customers?: string[];
    productModels?: string[];
    bases?: string[];
    orderType?: string;
    orderTypes?: string[];
  }): Promise<StationPassExport> {
    const qs = new URLSearchParams({
      dateFrom: params.dateFrom, dateTo: params.dateTo, orderScope: params.orderScope,
    });
    if (params.customer) qs.set('customer', params.customer);
    params.customers?.forEach(customer => qs.append('customers', customer));
    params.productModels?.forEach(model => qs.append('productModels', model));
    params.bases?.forEach(base => qs.append('bases', base));
    if (params.orderType) qs.set('orderType', params.orderType);
    params.orderTypes?.forEach(value => qs.append('orderTypes', value));
    return requestData<StationPassExport>(`${API_BASE_URL}/rty/cycle-export?${qs}`);
  },
  async getCycleDetails(params: RTYCycleDetailQuery): Promise<RTYCycleDetails> {
    const qs = new URLSearchParams({
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      orderScope: params.orderScope,
    });
    params.customers?.forEach(customer => qs.append('customers', customer));
    params.productModels?.forEach(model => qs.append('productModels', model));
    params.bases?.forEach(base => qs.append('bases', base));
    if (params.orderType) qs.set('orderType', params.orderType);
    params.orderTypes?.forEach(value => qs.append('orderTypes', value));
    return requestData<RTYCycleDetails>(`${API_BASE_URL}/rty/cycle-details?${qs}`);
  },

  async getStationPassRates(params: StationPassQuery): Promise<StationPassRate[]> {
    const query = buildStationPassQuery(params);
    const suffix = query.toString();
    // Station RTY must reflect the current filters and latest source snapshot.
    // Keep request coalescing in the browser out of this result path so a
    // repeated query does not reuse a multi-hour option cache entry.
    return requestData<StationPassRate[]>(`${API_BASE_URL}/rty/station-pass-rates${suffix ? `?${suffix}` : ''}`);
  },

  async getRepairQualityOptions(): Promise<RepairQualityOptions> {
    return requestData<RepairQualityOptions>(`${API_BASE_URL}/rty/repair-quality/options`);
  },

  async getRepairQuality(params: RepairQualityQuery): Promise<RepairQualitySummary> {
    const qs = buildRepairQualityQuery(params);
    return requestData<RepairQualitySummary>(`${API_BASE_URL}/rty/repair-quality?${qs}`);
  },

  async getRepairQualityExport(params: RepairQualityQuery): Promise<RepairQualityExport> {
    const qs = buildRepairQualityQuery(params);
    return requestData<RepairQualityExport>(`${API_BASE_URL}/rty/repair-quality/export?${qs}`);
  },

  async getRepairQualityDetails(params: RepairQualityDetailQuery, page = 1, exportAll = false): Promise<RepairQualityDetails> {
    const qs = buildRepairQualityQuery(params);
    qs.set('customer', params.customer);
    qs.set('base', params.base);
    qs.set('bucket', params.bucket);
    qs.set('page', String(page));
    if (exportAll) qs.set('exportAll', 'true');
    return requestData<RepairQualityDetails>(`${API_BASE_URL}/rty/repair-quality/details?${qs}`);
  },

  async getStationPassExport(params: StationPassQuery): Promise<StationPassExport> {
    return requestData<StationPassExport>(`${API_BASE_URL}/rty/station-pass-export?${buildStationPassQuery(params)}`);
  },

  async getStationPassDetails(stationCode: string, params: StationPassQuery, detailType: 'input' | 'defect' = 'input'): Promise<StationPassDetail[]> {
    const qs = buildStationPassQuery(params);
    qs.set('stationCode', stationCode);
    qs.set('detailType', detailType);
    return requestData<StationPassDetail[]>(`${API_BASE_URL}/rty/station-pass-details?${qs}`);
  },

  async getCycleData(
    orderScope: RTYFilterParams['orderScope'] = 'normal',
    customer?: string | string[],
    options: { dateFrom?: string; dateTo?: string; forceRefresh?: boolean; orderType?: string; orderTypes?: string[] } = {},
  ): Promise<CycleDataResult> {
    const dateFrom = options.dateFrom || '';
    const dateTo = options.dateTo || '';
    const customers = [...new Set([...(Array.isArray(customer) ? customer : customer ? [customer] : [])])].sort();
    const orderTypes = [...new Set(options.orderTypes || [])].sort();
    const key = scopedKey(`cycle-data-gamng:${orderScope}:${customers.join(',')}:${dateFrom}:${dateTo}${options.orderType ? `:type=${options.orderType}` : ''}${orderTypes.length ? `:types=${JSON.stringify(orderTypes)}` : ''}`);
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
      customers.forEach(value => qs.append('customers', value));
      if (dateFrom) qs.set('dateFrom', dateFrom);
      if (dateTo) qs.set('dateTo', dateTo);
      if (options.orderType) qs.set('orderType', options.orderType);
      orderTypes.forEach(value => qs.append('orderTypes', value));
      return requestData<RTYData[]>(`${API_BASE_URL}/rty/cycle-data?${qs.toString()}`);
    })();
    const entry = { expiresAt: Date.now() + RTY_CYCLE_CACHE_TTL_MS, promise, cachedAt: Date.now() };
    rtyCycleCache.set(key, entry);
    void promise.then((data) => setStoredCycleData(key, { ...entry, data }), () => undefined);
    void promise.catch(() => {
      if (rtyCycleCache.get(key)?.promise === promise) rtyCycleCache.delete(key);
    });
    return { data: await promise, cached: false, cachedAt: entry.cachedAt };
  },

  async getRTYData(params: RTYFilterParams, page = 1, pageSize = 50): Promise<PaginatedRTYResponse> {
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('limit', String(pageSize));
    buildRtyQuery(params).forEach((value, key) => qs.append(key, value));

    const requestKey = scopedKey(qs.toString());
    const inFlight = rtyListInFlight.get(requestKey);
    if (inFlight) return inFlight;
    const cached = rtyListCache.get(requestKey);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;

    const promise = requestJson<PaginatedRTYResponse>(`${API_BASE_URL}/rty/list?${qs}`)
      .then(json => {
        if (!Array.isArray(json.items)) throw new Error('RTY 列表响应格式无效');
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
    buildRtyQuery(params).forEach((value, key) => qs.append(key, value));
    const json = await requestJson<PaginatedExcludedOrdersResponse>(`${API_BASE_URL}/rty/excluded-orders?${qs}`);
    if (!Array.isArray(json.items)) throw new Error('已过滤订单响应格式无效');
    return json as PaginatedExcludedOrdersResponse;
  },

  async getDefectDetails(serialNumbers: string[]): Promise<DefectDetail[]> {
    if (!serialNumbers.length) return [];
    const qs = new URLSearchParams({ sns: serialNumbers.join(',') });
    return requestData<DefectDetail[]>(`${API_BASE_URL}/rty/defects?${qs}`);
  },

  async getDefectDetailsByOrder(productionOrder: string): Promise<DefectDetail[]> {
    const qs = new URLSearchParams({ productionOrder });
    return requestData<DefectDetail[]>(`${API_BASE_URL}/rty/defects/by-order?${qs}`);
  },

  async getDefectDetailsByFilters(params: RTYFilterParams): Promise<DefectDetail[]> {
    const qs = buildRtyQuery(params);

    return requestData<DefectDetail[]>(`${API_BASE_URL}/rty/defects/by-filters?${qs}`);
  },

  async getSalesOrderSummary(salesOrders: string[]): Promise<SalesOrderSummary[]> {
    if (!salesOrders.length) return [];
    const qs = new URLSearchParams({ salesOrders: salesOrders.join(',') });
    return requestData<SalesOrderSummary[]>(`${API_BASE_URL}/rty/sales-order-summary?${qs}`);
  },

  async getProductModels(orderScope: RTYFilterParams['orderScope'] = 'normal'): Promise<{ model: string; count: number }[]> {
    return cachedOption(`product-models:${orderScope}`, async () => {
      return requestData<{ model: string; count: number }[]>(`${API_BASE_URL}/rty/product-models?orderScope=${orderScope}`);
    });
  },

  async getBases(orderScope: RTYFilterParams['orderScope'] = 'normal'): Promise<{ base: string; count: number }[]> {
    return cachedOption(`bases:${orderScope}`, async () => {
      return requestData<{ base: string; count: number }[]>(`${API_BASE_URL}/rty/bases?orderScope=${orderScope}`);
    });
  },

  async getCustomers(orderScope: RTYFilterParams['orderScope'] = 'normal'): Promise<string[]> {
    return cachedOption(`customers:${orderScope}`, async () => {
      return requestData<string[]>(`${API_BASE_URL}/rty/customers?orderScope=${orderScope}`);
    });
  },

  async getFilterOptions(orderScope: RTYFilterParams['orderScope'] = 'normal'): Promise<{
    productModels: { model: string; count: number }[];
    bases: { base: string; count: number }[];
    customers: string[];
    orderTypes?: string[];
  }> {
    return cachedOption(`filter-options:${orderScope}`, async () => {
      return requestData<{
        productModels: { model: string; count: number }[];
        bases: { base: string; count: number }[];
        customers: string[];
        orderTypes?: string[];
      }>(`${API_BASE_URL}/rty/filter-options?orderScope=${orderScope}`);
    });
  },

};
