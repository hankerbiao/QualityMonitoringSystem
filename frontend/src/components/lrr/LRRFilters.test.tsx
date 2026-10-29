// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { lrrApi } from '../../api/lrrApi';
import LRRFilters from './LRRFilters';

vi.mock('../../api/lrrApi', () => ({ lrrApi: { getOptions: vi.fn() } }));

beforeEach(() => {
  vi.mocked(lrrApi.getOptions).mockResolvedValue({ materialNumbers: [], productModels: [], bases: [], customerIds: [] });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('defaults to all order types and submits selected types', async () => {
  vi.mocked(lrrApi.getOptions).mockResolvedValue({ materialNumbers: [], productModels: [], bases: [], customerIds: [], orderTypes: ['PP01', 'G001'] });
  const onSearch = vi.fn();
  render(<LRRFilters filters={{ plannedDateFrom: '2026-03-01', plannedDateTo: '2026-03-31' }} onSearch={onSearch} onReset={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: '全部订单类型' }));
  fireEvent.click(screen.getByRole('option', { name: 'PP01' }));
  fireEvent.click(screen.getByRole('option', { name: 'G001' }));
  fireEvent.click(screen.getByRole('button', { name: '查询' }));
  expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ orderTypes: ['PP01', 'G001'] }));
});

it('edits optional dates without searching until the form is submitted', async () => {
  const onSearch = vi.fn();
  render(<LRRFilters filters={{}} onSearch={onSearch} onReset={vi.fn()} />);
  const trigger = screen.getByRole('button', { name: '计划开始时间（GSTRS）' });
  expect(trigger.textContent).toContain('不限');
  fireEvent.click(trigger);
  fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-10-01' } });
  fireEvent.click(screen.getByRole('button', { name: '确定' }));
  expect(onSearch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '查询' }));
  expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ plannedDateFrom: '2026-10-01', plannedDateTo: null }));
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: '清除日期' }));
  expect(trigger.textContent).toContain('不限');
  expect(onSearch).toHaveBeenCalledTimes(1);
  await screen.findByRole('button', { name: '全部机型' });
});


it('submits newline-separated advanced filters', async () => {
  const onSearch = vi.fn();
  render(<LRRFilters filters={{ plannedDateFrom: '2026-03-01', plannedDateTo: '2026-03-31' }} onSearch={onSearch} onReset={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '高级筛选' }));
  fireEvent.change(screen.getByLabelText('SN'), { target: { value: 'SN1\nSN2' } });
  fireEvent.change(screen.getByLabelText('生产订单'), { target: { value: '1\n2' } });
  fireEvent.change(screen.getByLabelText('销售订单'), { target: { value: 'S1\nS2' } });
  fireEvent.click(screen.getByRole('button', { name: '查询' }));
  expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ serialNumbers: ['SN1', 'SN2'], productionOrders: ['1', '2'], salesOrders: ['S1', 'S2'] }));
});
