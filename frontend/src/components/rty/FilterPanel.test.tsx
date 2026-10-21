// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rtyApi } from '../../api/rtyApi';
import type { RTYFilterParams } from '../../types';
import { FilterPanel } from './FilterPanel';

vi.mock('../../api/rtyApi', () => ({
  rtyApi: { getFilterOptions: vi.fn() },
}));

const initialFilters: RTYFilterParams = {
  dateRange: { from: undefined, to: undefined },
  productModel: 'all',
  productModels: [],
  customer: '',
  customers: [],
  base: 'all',
  bases: [],
  salesOrder: '',
  productionOrder: '',
  serialNumber: '',
  orderScope: 'normal',
};

describe('RTY filter multi-selects', () => {
  afterEach(cleanup);

  it('supports selecting every model and keeps the final base selection', async () => {
    vi.mocked(rtyApi.getFilterOptions).mockResolvedValue({
      productModels: [{ model: 'Model A', count: 1 }, { model: 'Model B', count: 2 }],
      bases: [{ base: 'Factory A', count: 1 }, { base: 'Factory B', count: 2 }],
      customers: ['CUST-A', 'CUST-B'],
    });
    const onFiltersChange = vi.fn();
    render(<FilterPanel initialFilters={initialFilters} onFiltersChange={onFiltersChange} onSearch={vi.fn()} onAlertModalOpen={vi.fn()} onExportConfirm={vi.fn()} exporting={false} exportDisabled={false} />);

    fireEvent.click(await screen.findByRole('button', { name: '选择机型' }));
    const modelMenu = screen.getByRole('button', { name: '全选' }).parentElement?.parentElement;
    fireEvent.click(within(modelMenu as HTMLElement).getByRole('button', { name: '全选' }));
    expect(onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({ productModels: ['Model A', 'Model B'] }));

    fireEvent.click(screen.getByRole('button', { name: '选择基地' }));
    const baseMenu = screen.getByLabelText('搜索基地').parentElement?.parentElement;
    fireEvent.click(within(baseMenu as HTMLElement).getByRole('checkbox', { name: /Factory A/ }));
    fireEvent.click(within(baseMenu as HTMLElement).getByRole('checkbox', { name: /Factory B/ }));
    expect(onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({ bases: ['Factory A', 'Factory B'] }));
    expect((within(baseMenu as HTMLElement).getByRole('checkbox', { name: /Factory A/ }) as HTMLInputElement).checked).toBe(true);
    expect((within(baseMenu as HTMLElement).getByRole('checkbox', { name: /Factory B/ }) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(within(baseMenu as HTMLElement).getByRole('button', { name: '全选' }));
    expect(onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({ bases: ['Factory A', 'Factory B'] }));
  });

  it('allows multiple customers and exposes the no-customer option', async () => {
    vi.mocked(rtyApi.getFilterOptions).mockResolvedValue({
      productModels: [],
      bases: [],
      customers: ['CUST-A', 'CUST-B'],
    });
    const onFiltersChange = vi.fn();
    render(<FilterPanel initialFilters={initialFilters} onFiltersChange={onFiltersChange} onSearch={vi.fn()} onAlertModalOpen={vi.fn()} onExportConfirm={vi.fn()} exporting={false} exportDisabled={false} />);

    fireEvent.click(await screen.findByRole('button', { name: '选择客户 ID' }));
    const menu = screen.getByLabelText('搜索客户 ID').parentElement?.parentElement;
    fireEvent.click(within(menu as HTMLElement).getByRole('checkbox', { name: 'CUST-A' }));
    fireEvent.click(within(menu as HTMLElement).getByRole('checkbox', { name: 'CUST-B' }));
    fireEvent.click(within(menu as HTMLElement).getByRole('checkbox', { name: '无客户ID' }));
    expect(onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({
      customers: ['CUST-A', 'CUST-B', '__NO_CUSTOMER_ID__'],
    }));
  });
});
