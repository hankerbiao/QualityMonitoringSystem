// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { processRecordsApi } from '../api/processRecordsApi';
import type { ProcessRecordItem, ProcessRecordRealtimeData } from '../types';
import ProcessRecordsPage from './ProcessRecordsPage';

vi.mock('../api/processRecordsApi', () => ({
  processRecordsApi: { getRealtime: vi.fn(), getFilterOptions: vi.fn() },
}));

const record: ProcessRecordItem = {
  key: 'system1:1',
  source: 'system1',
  sourceName: '工序扫码拍照',
  recordId: '1',
  sn: 'SN-RECOVERED',
  base: '天津',
  station: 'TJM-OP320',
  submittedAt: '',
  order: '',
  remarks: '',
  files: '',
  photos: [],
  raw: {},
};

const emptyData: ProcessRecordRealtimeData = {
  queriedAt: '2026-10-14T00:00:00Z',
  source: 'all',
  page: 1,
  pageSize: 30,
  total: 0,
  rows: [],
  sources: {
    system1: { online: true, total: 0, rows: [] },
    system2: { online: true, total: 0, rows: [] },
  },
};

describe('ProcessRecordsPage source failures', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(processRecordsApi.getFilterOptions).mockResolvedValue({
      bases: [],
      system1Processes: [],
    });
  });

  afterEach(cleanup);

  it('shows source errors and recovers records through retry', async () => {
    vi.mocked(processRecordsApi.getRealtime)
      .mockResolvedValueOnce({
        ...emptyData,
        sources: {
          system1: { online: false, total: 0, rows: [], error: '登录失效' },
          system2: { online: false, total: 0, rows: [], error: '连接超时' },
        },
      })
      .mockResolvedValue({
        ...emptyData,
        total: 1,
        rows: [record],
        sources: {
          ...emptyData.sources,
          system1: { online: true, total: 1, rows: [record] },
        },
      });

    render(<MemoryRouter><ProcessRecordsPage /></MemoryRouter>);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('登录失效');
    expect(alert.textContent).toContain('连接超时');
    expect(screen.queryByText('没有查询到记录')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '重新查询' }));
    expect(await screen.findByText('SN-RECOVERED')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('keeps healthy source records visible when the other source fails', async () => {
    vi.mocked(processRecordsApi.getRealtime).mockResolvedValue({
      ...emptyData,
      total: 1,
      rows: [record],
      sources: {
        system1: { online: true, total: 1, rows: [record] },
        system2: { online: false, total: 0, rows: [], error: '连接超时' },
      },
    });

    render(<MemoryRouter><ProcessRecordsPage /></MemoryRouter>);

    expect(await screen.findByText('SN-RECOVERED')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('装配关键工位');
    expect(screen.getByRole('alert').textContent).toContain('连接超时');
  });

  it('shows an empty result only when both sources succeed', async () => {
    vi.mocked(processRecordsApi.getRealtime).mockResolvedValue(emptyData);

    render(<MemoryRouter><ProcessRecordsPage /></MemoryRouter>);

    expect(await screen.findByText('没有查询到记录')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not present an API failure as an empty result', async () => {
    vi.mocked(processRecordsApi.getRealtime).mockRejectedValue(new Error('查询服务暂不可用'));

    render(<MemoryRouter><ProcessRecordsPage /></MemoryRouter>);

    expect((await screen.findByRole('alert')).textContent).toContain('查询服务暂不可用');
    expect(screen.queryByText('没有查询到记录')).toBeNull();
  });
});
