// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DoaDashboard, DoaFilters } from '../types/doa';
import { readDoaCache, writeDoaCache } from './doaCache';

const filters: DoaFilters = { dateFrom: '2026-09-01', dateTo: '2026-09-30', customer: '', model: '', customers: ['B', 'A'], timeGranularity: 'month' };
const dashboard = { cacheExpiresAt: '2026-09-01T02:00:00.000Z', summary: { repairCount: 10 } } as DoaDashboard;

describe('DOA dashboard cache', () => {
  afterEach(() => { sessionStorage.clear(); vi.useRealTimers(); });
  it('reuses the result for equivalent filters and the same account until the server expiry', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-01T00:00:00Z'));
    writeDoaCache('alice', filters, dashboard);
    expect(readDoaCache('alice', { ...filters, customers: ['A', 'B'] })).toEqual(dashboard);
    expect(readDoaCache('bob', filters)).toBeNull();
    expect(readDoaCache('alice', { ...filters, model: 'M2' })).toBeNull();
    vi.setSystemTime(new Date('2026-09-01T01:59:59Z'));
    expect(readDoaCache('alice', filters)).toEqual(dashboard);
    vi.setSystemTime(new Date('2026-09-01T02:00:00Z'));
    expect(readDoaCache('alice', filters)).toBeNull();
  });
  it('does not cache without a server expiry or a user identity', () => {
    writeDoaCache('', filters, dashboard);
    writeDoaCache('alice', filters, { ...dashboard, cacheExpiresAt: undefined });
    expect(sessionStorage.length).toBe(0);
  });
});
