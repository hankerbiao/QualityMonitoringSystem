// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import DoaOrdersPage from './DoaOrdersPage';
import DoaRepairsPage from './DoaRepairsPage';

vi.mock('../api/doaApi', () => ({ doaApi: {
  getOrders: vi.fn().mockResolvedValue({ items: [], total: 0, totalQuantity: 0 }),
  getRepairs: vi.fn().mockResolvedValue({ items: [], total: 0, totalRepairCount: 0 }),
  buildQuery: vi.fn().mockReturnValue(''),
} }));

afterEach(cleanup);

it('explains the planned order denominator on the order detail page', async () => {
  render(<MemoryRouter><DoaOrdersPage /></MemoryRouter>);
  await screen.findByText(/计划订单 0 条/);
  const button = screen.getByRole('button', { name: '查看到货数据明细计算说明' });
  fireEvent.mouseEnter(button.parentElement!);
  expect(screen.getByRole('tooltip').textContent).toContain('计划数量之和');
});

it('explains the separate unmatched date scope on the repair detail page', async () => {
  render(<MemoryRouter initialEntries={['/doa/repairs?unmatchedOnly=true']}><DoaRepairsPage /></MemoryRouter>);
  await screen.findByText(/当前筛选命中 0 条/);
  const button = screen.getByRole('button', { name: '查看报修明细计算说明' });
  fireEvent.focus(button);
  expect(screen.getByRole('tooltip').textContent).toContain('不受日期筛选，不计入当前报修率');
});
