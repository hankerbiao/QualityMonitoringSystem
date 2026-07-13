import { RTYData, DefectDetail, InputDetail, RTYFilterParams, SalesOrderSummary } from '../types';
import { apiFetch } from './authApi';

export const rtyApi = {
  async getRTYData(params: RTYFilterParams): Promise<RTYData[]> {
    const qs = new URLSearchParams();
    if (params.statMethod) qs.set('stat_method', params.statMethod);
    if (params.dateRange.from) qs.set('dateFrom', params.dateRange.from.toISOString().split('T')[0]);
    if (params.dateRange.to) qs.set('dateTo', params.dateRange.to.toISOString().split('T')[0]);
    if (params.model && params.model !== 'all') qs.set('model', params.model);
    if (params.productModel && params.productModel !== 'all') qs.set('productModel', params.productModel);
    if (params.customer) qs.set('customer', params.customer);
    if (params.base && params.base !== 'all') qs.set('base', params.base);
    if (params.salesOrder) qs.set('salesOrder', params.salesOrder);
    if (params.productionOrder) qs.set('productionOrder', params.productionOrder);
    if (params.serialNumber) qs.set('serialNumber', params.serialNumber);

    const res = await apiFetch(`/api/rty/list?${qs}`);
    const json = await res.json();
    return json.success ? json.data : [];
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

  async getInputDetails(serialNumbers: string[]): Promise<InputDetail[]> {
    if (!serialNumbers.length) return [];
    const qs = new URLSearchParams({ sns: serialNumbers.join(',') });
    const res = await apiFetch(`/api/rty/inputs?${qs}`);
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

  async getProductionOrdersBySalesOrder(salesOrder: string): Promise<string[]> {
    const qs = new URLSearchParams({ salesOrder });
    const res = await apiFetch(`/api/rty/production-orders/by-sales-order?${qs}`);
    const json = await res.json();
    return json.success ? json.data : [];
  },

  async getProductModels(): Promise<{ model: string; count: number }[]> {
    const res = await apiFetch('/api/rty/product-models');
    const json = await res.json();
    return json.success ? json.data : [];
  },
};