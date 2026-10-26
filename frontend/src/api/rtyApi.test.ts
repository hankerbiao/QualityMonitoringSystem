// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearRtyApiCache, rtyApi } from './rtyApi';
import { requestData, requestJson } from './authApi';
import type { RTYFilterParams } from '../types';

vi.mock('./authApi', () => ({ requestData: vi.fn(), requestJson: vi.fn() }));

describe('rtyApi list cache', () => {
  afterEach(() => {
    clearRtyApiCache();
    vi.mocked(requestData).mockReset();
    vi.mocked(requestJson).mockReset();
  });

  it('coalesces identical list requests', async () => {
    vi.mocked(requestJson).mockResolvedValue({
      items: [], total: 0, page: 1, limit: 50, has_more: false,
    });
    const filters: RTYFilterParams = {
      dateRange: { from: undefined, to: undefined }, productModel: 'all', customer: '', base: 'all', salesOrder: '',
      productionOrder: '', serialNumber: '', orderScope: 'normal' as const,
    };

    await Promise.all([rtyApi.getRTYData(filters), rtyApi.getRTYData(filters)]);

    expect(requestJson).toHaveBeenCalledTimes(1);
  });

  it('preserves multi-select RTY filters as repeated query parameters', async () => {
    vi.mocked(requestJson).mockResolvedValue({
      items: [], total: 0, page: 1, limit: 50, has_more: false,
    });
    const filters: RTYFilterParams = {
      dateRange: { from: undefined, to: undefined }, productModel: 'all', customer: '', base: 'all', salesOrder: '',
      productionOrder: '', serialNumber: '', orderScope: 'normal',
      productModels: ['M-1', 'M-2'], bases: ['B-1', 'B-2'], customers: ['C-1', '__NO_CUSTOMER_ID__'],
    };

    await rtyApi.getRTYData(filters);

    const query = new URL(vi.mocked(requestJson).mock.calls[0][0], 'http://localhost').searchParams;
    expect(query.getAll('productModels')).toEqual(['M-1', 'M-2']);
    expect(query.getAll('bases')).toEqual(['B-1', 'B-2']);
    expect(query.getAll('customers')).toEqual(['C-1', '__NO_CUSTOMER_ID__']);
  });

  it('sends exact cycle date bounds and keeps each range in a separate cache entry', async () => {
    vi.mocked(requestData).mockResolvedValue([]);

    await rtyApi.getCycleData('normal', undefined, {
      dateFrom: '2026-04-14',
      dateTo: '2026-04-20',
    });
    await rtyApi.getCycleData('normal', undefined, {
      dateFrom: '2026-04-15',
      dateTo: '2026-04-20',
    });

    expect(requestData).toHaveBeenNthCalledWith(
      1,
      '/api/rty/cycle-data?orderScope=normal&dateFrom=2026-04-14&dateTo=2026-04-20',
    );
    expect(requestData).toHaveBeenNthCalledWith(
      2,
      '/api/rty/cycle-data?orderScope=normal&dateFrom=2026-04-15&dateTo=2026-04-20',
    );
  });

  it('includes the selected customer in station summaries and details', async () => {
    vi.mocked(requestData).mockResolvedValue([]);
    const query = { groupBy: 'productModel' as const, customer: 'CUST-1', overseas: true };

    await rtyApi.getStationPassRates(query);
    await rtyApi.getStationPassDetails('OP10', query);

    expect(requestData).toHaveBeenNthCalledWith(
      1,
      '/api/rty/station-pass-rates?groupBy=productModel&orderScope=normal&customer=CUST-1&overseas=true',
    );
    expect(requestData).toHaveBeenNthCalledWith(
      2,
      '/api/rty/station-pass-details?groupBy=productModel&orderScope=normal&customer=CUST-1&overseas=true&stationCode=OP10&detailType=input',
    );
  });

  it('does not reuse the long-lived option cache for station summaries', async () => {
    vi.mocked(requestData).mockResolvedValue([]);
    const query = { groupBy: 'productModel' as const, productModel: 'M-1' };

    await rtyApi.getStationPassRates(query);
    await rtyApi.getStationPassRates(query);

    expect(requestData).toHaveBeenCalledTimes(2);
  });

  it('exports raw station sources using all applied filters without caching', async () => {
    vi.mocked(requestData).mockResolvedValue({ orders: [], faults: [] });
    const query = {
      dateFrom: '2026-10-05', dateTo: '2026-10-11',
      groupBy: 'productionOrder' as const, orderScope: 'l6' as const,
      customer: 'C', productModel: 'M', serialNumber: 'SN', base: 'B',
    };

    await rtyApi.getStationPassExport(query);
    await rtyApi.getStationPassExport(query);

    const url = new URL(vi.mocked(requestData).mock.calls[0][0], 'http://localhost');
    expect(url.pathname).toBe('/api/rty/station-pass-export');
    expect(Object.fromEntries(url.searchParams)).toEqual(query);
    expect(requestData).toHaveBeenCalledTimes(2);
  });

  it('passes all applied filters to the uncached template export endpoint', async () => {
    const payload = { summary: [], orders: [], faults: [], topProblems: [] };
    vi.mocked(requestData).mockResolvedValue(payload);
    const filters: RTYFilterParams = {
      dateRange: { from: new Date('2026-09-01'), to: new Date('2026-09-30') },
      productModel: 'M', customer: 'C', base: 'B', salesOrder: 'SO',
      productionOrder: 'PO', serialNumber: 'SN', orderScope: 'l6',
    };

    expect(await rtyApi.getTemplateExport(filters)).toBe(payload);
    await rtyApi.getTemplateExport(filters);

    const query = new URL(vi.mocked(requestData).mock.calls[0][0], 'http://localhost');
    expect(query.pathname).toBe('/api/rty/export');
    expect(Object.fromEntries(query.searchParams)).toEqual({
      dateFrom: '2026-09-01', dateTo: '2026-09-30', productModel: 'M', customer: 'C',
      base: 'B', salesOrder: 'SO', productionOrder: 'PO', serialNumber: 'SN', orderScope: 'l6',
    });
    expect(requestData).toHaveBeenCalledTimes(2);
  });

  it('exports cycle sources with repeated exact model and base filters using RTY permissions', async () => {
    const payload = { orders: [], faults: [] };
    vi.mocked(requestData).mockResolvedValue(payload);
    const filters = {
      dateFrom: '2026-10-05', dateTo: '2026-10-11', orderScope: 'l6' as const,
      customer: 'Customer 1', productModels: ['M, A', 'M B'], bases: ['B', 'D'],
    };

    expect(await rtyApi.getCycleExport(filters)).toBe(payload);
    await rtyApi.getCycleExport(filters);

    const url = new URL(vi.mocked(requestData).mock.calls[0][0], 'http://localhost');
    expect(url.pathname).toBe('/api/rty/cycle-export');
    expect(url.searchParams.getAll('productModels')).toEqual(filters.productModels);
    expect(url.searchParams.getAll('bases')).toEqual(filters.bases);
    expect(url.searchParams.get('dateFrom')).toBe(filters.dateFrom);
    expect(url.searchParams.get('dateTo')).toBe(filters.dateTo);
    expect(url.searchParams.get('customer')).toBe(filters.customer);
    expect(url.searchParams.get('orderScope')).toBe('l6');
    expect(requestData).toHaveBeenCalledTimes(2);
  });

  it('requests cycle details with repeated model, base, and customer filters', async () => {
    const payload = { orders: [], faults: [] };
    vi.mocked(requestData).mockResolvedValue(payload);
    const query = {
      dateFrom: '2026-09-10',
      dateTo: '2026-09-30',
      orderScope: 'normal' as const,
      productModels: ['Model A', 'Model B'],
      bases: ['B', 'D'],
      customers: ['C-1', '__NO_CUSTOMER_ID__'],
    };

    expect(await rtyApi.getCycleDetails(query)).toBe(payload);

    const url = new URL(vi.mocked(requestData).mock.calls[0][0], 'http://localhost');
    expect(url.pathname).toBe('/api/rty/cycle-details');
    expect(url.searchParams.getAll('productModels')).toEqual(query.productModels);
    expect(url.searchParams.getAll('bases')).toEqual(query.bases);
    expect(url.searchParams.getAll('customers')).toEqual(query.customers);
    expect(url.searchParams.get('dateFrom')).toBe(query.dateFrom);
    expect(url.searchParams.get('dateTo')).toBe(query.dateTo);
    expect(url.searchParams.get('orderScope')).toBe(query.orderScope);
  });
});
