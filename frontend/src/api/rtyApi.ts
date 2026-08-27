import { DefectDetail, RTYData, RTYFilterParams, SalesOrderSummary, PaginatedRTYResponse } from '../types';
import { apiFetch } from './authApi';

const RTY_LIST_CACHE_TTL_MS = 2_000;
const rtyListCache = new Map<string, { expiresAt: number; promise: Promise<PaginatedRTYResponse> }>();
const rtyListInFlight = new Map<string, Promise<PaginatedRTYResponse>>();
const RTY_OPTIONS_CACHE_TTL_MS = 60_000;
const rtyOptionsCache = new Map<string, { expiresAt: number; promise: Promise<unknown> }>();

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

export const rtyApi = {
  async getCycleData(
    orderScope: RTYFilterParams['orderScope'] = 'normal',
    customer?: string,
  ): Promise<RTYData[]> {
    return cachedOption(`cycle-data:${orderScope}:${customer || ''}`, async () => {
      const qs = new URLSearchParams({ orderScope });
      if (customer) qs.set('customer', customer);
      const res = await apiFetch(`/api/rty/cycle-data?${qs.toString()}`);
      const json = await res.json();
      return json.success ? (json.data as RTYData[]) : [];
    });
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
