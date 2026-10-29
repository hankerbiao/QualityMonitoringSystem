// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { doaApi } from './doaApi';

describe('DOA query parameters', () => {
  it('preserves multi-select values as repeated parameters', () => {
    const params = new URLSearchParams(doaApi.buildQuery({
      dateFrom: '2026-01-01', dateTo: '2026-10-27', customer: '', model: '',
      customers: ['客户 B', '客户 A'], models: ['M2', 'M1'], timeGranularity: 'month',
    }));
    expect(params.getAll('customers')).toEqual(['客户 A', '客户 B']);
    expect(params.getAll('models')).toEqual(['M1', 'M2']);
  });
});

describe('DOA repair export', () => {
  const filters = { dateFrom: '2026-01-01', dateTo: '2026-01-31', customer: '', model: '', timeGranularity: 'month' as const };
  it('collects every page of matching records', async () => {
    const mock = vi.spyOn(doaApi, 'getRepairs').mockResolvedValueOnce({ items: [{ id: 'a' }] as never, total: 2, totalRepairCount: 2, page: 1, limit: 1, has_more: true }).mockResolvedValueOnce({ items: [{ id: 'b' }] as never, total: 2, totalRepairCount: 2, page: 2, limit: 1, has_more: false });
    try {
      expect((await doaApi.getAllRepairs(filters, false, 1)).map(row => row.id)).toEqual(['a', 'b']);
    } finally { mock.mockRestore(); }
  });
  it('rejects a changing total instead of exporting incomplete data', async () => {
    const mock = vi.spyOn(doaApi, 'getRepairs').mockResolvedValueOnce({ items: [{ id: 'a' }] as never, total: 2, totalRepairCount: 2, page: 1, limit: 1, has_more: true }).mockResolvedValueOnce({ items: [{ id: 'b' }] as never, total: 3, totalRepairCount: 3, page: 2, limit: 1, has_more: true });
    try {
      await expect(doaApi.getAllRepairs(filters, false, 1)).rejects.toThrow();
    } finally { mock.mockRestore(); }
  });
});

describe('DOA order export', () => {
  it('exports all pages rather than only the visible order page', async () => {
    const filters = { dateFrom: '2026-09-01', dateTo: '2026-09-30', customer: '', model: '', timeGranularity: 'month' as const };
    const first = Array.from({ length: 1000 }, (_, i) => ({ salesOrder: String(i) })) as never;
    const mock = vi.spyOn(doaApi, 'getOrders').mockResolvedValueOnce({ items: first, total: 1001, totalQuantity: 1001, page: 1, limit: 1000 }).mockResolvedValueOnce({ items: [{ salesOrder: 'last' }] as never, total: 1001, totalQuantity: 1001, page: 2, limit: 1000 });
    try {
      const rows = await doaApi.getAllOrders(filters);
      expect(rows).toHaveLength(1001);
      expect(rows[1000].salesOrder).toBe('last');
    } finally { mock.mockRestore(); }
  });
});
