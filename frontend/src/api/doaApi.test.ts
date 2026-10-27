// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
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
