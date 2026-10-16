// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { settingsApi } from '../../api/settingsApi';
import { ModelTargetsTab } from './ModelTargetsTab';
import { TARGET_TEMPLATE_HEADERS } from './modelTargetsTemplate';

vi.mock('../../api/settingsApi', () => ({ settingsApi: { getModelTargetSourceModels: vi.fn() } }));
vi.mock('xlsx', async importOriginal => ({
  ...await importOriginal<typeof import('xlsx')>(), writeFile: vi.fn(),
}));

function Harness() {
  const [targets, setTargets] = useState({ Existing: 97 } as Record<string, number>);
  return <ModelTargetsTab targets={targets} onChange={setTargets} />;
}

function file(rows: unknown[][]): File {
  const result = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(result, XLSX.utils.aoa_to_sheet([TARGET_TEMPLATE_HEADERS, ...rows]), '直通率标准');
  return new File([XLSX.write(result, { type: 'array', bookType: 'xlsx' })], 'targets.xlsx');
}

describe('model target bulk controls', () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(cleanup);

  it('downloads fresh source models with draft targets and 100 defaults', async () => {
    vi.mocked(settingsApi.getModelTargetSourceModels).mockResolvedValue(['M', 'L6']);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '下载模板' }));
    await waitFor(() => expect(XLSX.writeFile).toHaveBeenCalledOnce());
    const exported = vi.mocked(XLSX.writeFile).mock.calls[0][0];
    expect(XLSX.utils.sheet_to_json(exported.Sheets['直通率标准'])).toEqual([
      { 机型名称: 'Existing', '直通率标准 (%)': 97 },
      { 机型名称: 'L6', '直通率标准 (%)': 100 },
      { 机型名称: 'M', '直通率标准 (%)': 100 },
    ]);
  });

  it('merges imported rows, defaults blanks and supports reimporting the same file', async () => {
    render(<Harness />);
    const input = screen.getByLabelText('选择直通率标准模板');
    const imported = file([['M', 98.5], ['Blank', null]]);
    fireEvent.change(input, { target: { files: [imported] } });
    expect((await screen.findByRole('status')).textContent).toContain('已导入 2 个机型，待保存');
    expect((screen.getByLabelText('M 直通率标准') as HTMLInputElement).value).toBe('98.5');
    expect((screen.getByLabelText('Blank 直通率标准') as HTMLInputElement).value).toBe('100');
    expect((screen.getByLabelText('Existing 直通率标准') as HTMLInputElement).value).toBe('97');
    fireEvent.change(input, { target: { files: [imported] } });
    expect((await screen.findByRole('status')).textContent).toContain('已导入');
  });

  it('leaves drafts untouched if any imported row is invalid', async () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('选择直通率标准模板'), {
      target: { files: [file([['Existing', 99], ['Invalid', 101]])] },
    });
    expect((await screen.findByRole('alert')).textContent).toContain('第 3 行');
    expect((screen.getByLabelText('Existing 直通率标准') as HTMLInputElement).value).toBe('97');
    expect(screen.queryByLabelText('Invalid 直通率标准')).toBeNull();
  });

  it('reports source failures and allows retry', async () => {
    vi.mocked(settingsApi.getModelTargetSourceModels).mockRejectedValue(new Error('数据源不可用'));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '下载模板' }));
    expect((await screen.findByRole('alert')).textContent).toContain('数据源不可用');
    expect(XLSX.writeFile).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: '下载模板' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('searches and paginates many models and adds new models at 100 by default', () => {
    const targets = Object.fromEntries(Array.from({ length: 125 }, (_, i) => [`Model${i}`, 99]));
    render(<ModelTargetsTab targets={targets} onChange={vi.fn()} />);
    expect(screen.getAllByRole('row')).toHaveLength(51);
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(screen.getByText('2 / 3')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('搜索机型'), { target: { value: 'Model124' } });
    expect(screen.getAllByRole('row')).toHaveLength(2);
    cleanup();
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('新增机型'), { target: { value: 'Added' } });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    expect((screen.getByLabelText('Added 直通率标准') as HTMLInputElement).value).toBe('100');
  });
});
