// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import { AdvancedFilters, EMPTY_ADVANCED_FILTERS, advancedQuery } from './AdvancedFilters';

afterEach(cleanup);

it('expands, preserves newline input, and deduplicates exact values', () => {
  function Form() {
    const [value, setValue] = useState(EMPTY_ADVANCED_FILTERS);
    return <><AdvancedFilters value={value} onChange={setValue} /><output>{JSON.stringify(advancedQuery(value))}</output></>;
  }
  render(<Form />);
  fireEvent.click(screen.getByRole('button', { name: '高级筛选' }));
  fireEvent.change(screen.getByLabelText('SN'), { target: { value: ' SN1\nSN2\nSN1\n' } });
  fireEvent.change(screen.getByLabelText('生产订单'), { target: { value: '100\n200' } });
  expect(screen.getByRole('status').textContent).toBe('{"serialNumbers":["SN1","SN2"],"productionOrders":["100","200"]}');
  fireEvent.click(screen.getByRole('button', { name: /高级筛选/ }));
  expect(screen.queryByLabelText('SN')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /高级筛选/ }));
  expect((screen.getByLabelText('SN') as HTMLTextAreaElement).value).toBe(' SN1\nSN2\nSN1\n');
});
