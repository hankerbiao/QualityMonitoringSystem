// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MultiSelect } from './MultiSelect';

afterEach(cleanup);

describe('MultiSelect', () => {
  it('keeps option order and scroll position while selecting and deselecting', () => {
    const options = Array.from({ length: 40 }, (_, index) => `机型 ${index + 1}`);
    function Example() {
      const [value, setValue] = useState<string[]>([]);
      return <MultiSelect label="机型（多选）" options={options} value={value} onChange={setValue} />;
    }

    render(<Example />);
    fireEvent.click(screen.getByRole('button', { name: '机型（多选）' }));
    const dialog = screen.getByRole('dialog', { name: '选择机型' });
    const option = within(dialog).getByRole('checkbox', { name: '机型 25' });
    const list = option.parentElement!.parentElement!;
    list.scrollTop = 300;

    for (const name of ['机型 25', '机型 26', '机型 25']) {
      fireEvent.click(within(dialog).getByRole('checkbox', { name }));
      expect(within(dialog).getAllByRole('checkbox').map((checkbox) => checkbox.parentElement!.textContent)).toEqual(options);
      expect(list.scrollTop).toBe(300);
    }
    expect((within(dialog).getByRole('checkbox', { name: '机型 26' }) as HTMLInputElement).checked).toBe(true);
  });
});
