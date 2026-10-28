// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { requestData } from './authApi';
import { reinsertApi } from './reinsertApi';

vi.mock('./authApi', () => ({ requestData: vi.fn() }));

describe('reinsert detail query', () => {
  it('preserves an empty model as an explicit filter', () => {
    reinsertApi.details({ dateFrom: '2026-01-01', dateTo: '2026-01-31', kind: 'orders', base: 'B1', month: '2026-01', model: '' });
    const url = vi.mocked(requestData).mock.calls[0][0];
    expect(new URLSearchParams(url.split('?')[1]).get('model')).toBe('');
  });
});
