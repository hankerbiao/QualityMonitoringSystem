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
