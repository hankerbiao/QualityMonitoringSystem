// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { apiFetch, requestData } from '../api/authApi';
import IncomingMaterialsPage from './IncomingMaterialsPage';

vi.mock('../api/authApi', () => ({ requestData: vi.fn(), apiFetch: vi.fn().mockResolvedValue({ ok: false }) }));
vi.mock('xlsx', async importOriginal => ({ ...await importOriginal<typeof import('xlsx')>(), writeFile: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('filters and clears loaded data without requesting the upstream again', async () => {
  vi.mocked(requestData).mockResolvedValue({
    queriedAt: '2026-10-29T00:00:00Z', upstreamTotal: 1000, readCount: 1000,
    matchedCount: 2, complete: true,
    rows: [{ id: 1, location_info: 'DN00', selmatnr: 'ABC' }, { id: 2, location_info: '9N00', selmatnr: 'XYZ' }],
  });
  render(<MemoryRouter><IncomingMaterialsPage /></MemoryRouter>);
  expect(await screen.findByText('DN00')).toBeTruthy();
  expect(screen.getByText('已读取全部上游分页')).toBeTruthy();
  expect(screen.getByText('库位匹配 *N00')).toBeTruthy();
  expect(screen.getByText('仅显示库位信息以 N00 结尾的记录，如 DN00、9N00。')).toBeTruthy();
  expect(screen.queryByText('上游总记录')).toBeNull();
  expect(screen.queryByText('已读取记录')).toBeNull();
  expect(screen.queryByText('符合 N00 库位')).toBeNull();
  expect(screen.queryByText('覆盖范围')).toBeNull();
  expect(screen.getByText('XYZ')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('关键词（搜索所有字段）'), { target: { value: 'ABC' } });
  fireEvent.click(screen.getByRole('button', { name: '筛选数据' }));
  expect(screen.queryByText('XYZ')).toBeNull();
  expect(screen.getByText('共 1 条 · 点击详情查看完整字段')).toBeTruthy();
  expect(requestData).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  await waitFor(() => expect(requestData).toHaveBeenCalledTimes(2));
  await screen.findByText('DN00');
  expect(screen.queryByText('XYZ')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '清空' }));
  expect(screen.getByText('XYZ')).toBeTruthy();
  expect(requestData).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  await waitFor(() => expect(requestData).toHaveBeenCalledTimes(3));
});

it('shows upstream errors', async () => {
  vi.mocked(requestData).mockRejectedValue(new Error('上游不可用'));
  render(<MemoryRouter><IncomingMaterialsPage /></MemoryRouter>);
  expect((await screen.findByRole('alert')).textContent).toContain('上游不可用');
});

it('loads image thumbnails and opens a larger preview', async () => {
  const path = 'Upload/Tables/Tb_abnormal_incoming_materials/2025/图片.jpg';
  vi.mocked(requestData).mockResolvedValue({
    queriedAt: '2026-10-29T00:00:00Z', upstreamTotal: 1, readCount: 1, matchedCount: 1, complete: true,
    rows: [{ id: 1, location_info: 'DN00', bad_img: path, _incomingPhotos: [{ path, accessToken: 'grant' }] }],
  });
  vi.mocked(apiFetch).mockResolvedValue({ ok: true, blob: async () => new Blob(['image']) } as Response);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:image') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  try {
    render(<MemoryRouter><IncomingMaterialsPage /></MemoryRouter>);
    expect((await screen.findByRole('img', { name: '不良图片 1' })).getAttribute('src')).toBe('blob:image');
    fireEvent.click(screen.getByRole('button', { name: '查看第 1 张不良图片' }));
    expect((await screen.findByRole('img', { name: '不良图片大图' })).getAttribute('src')).toBe('blob:image');
    expect(vi.mocked(apiFetch).mock.calls.some(([url]) => String(url).includes('/incoming-materials/image?'))).toBe(true);
  } finally { vi.mocked(apiFetch).mockReset().mockResolvedValue({ ok: false } as Response); }
});

it('shows the original system columns in order with the corresponding values', async () => {
  vi.mocked(requestData).mockResolvedValue({
    queriedAt: '2026-10-29T00:00:00Z', upstreamTotal: 1, readCount: 1,
    matchedCount: 1, complete: true,
    rows: [{ id: 1, location_info: 'DN00', supplier_code: 'SUP-1', bad_img: 'Upload/Tables/example.jpg', _incomingPhotos: [{ path: 'Upload/Tables/example.jpg', accessToken: 'test-token' }], creator: '录入人甲', creator_user: '创建账号乙' }],
  });
  render(<MemoryRouter><IncomingMaterialsPage /></MemoryRouter>);
  await screen.findByText('DN00');
  const table = screen.getByRole('table');
  expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual([
    '检验批号', '物料编号', '物料描述', '到货数量', '供应商', '供应商代码', '库位信息', '到货日期', '订单号',
    '解决时长（H）', '质量成本', '基地', '异常描述', '不良图片', '异常分类', '首件', '不良数量', '录入日期',
    '创建人', '解决方案', '处理日期', '责任单位', '责任人', '原因分析', '8D报告路径', '事件类型', '物料状态',
    '状态', '备注', '处理人', '修改人', '修改时间', '接收邮件人', '创建人', '操作',
  ]);
  expect(within(table).getByText('SUP-1')).toBeTruthy();
  expect(within(table).getByRole('button', { name: '查看第 1 张不良图片' })).toBeTruthy();
  fireEvent.click(within(table).getByRole('button', { name: '查看第 1 张不良图片' }));
  expect(screen.getByRole('dialog', { name: '不良图片预览' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '关闭图片预览' }));
  expect(within(table).getByText('录入人甲')).toBeTruthy();
  expect(within(table).getByText('创建账号乙')).toBeTruthy();
});

it('only offers bases available to the current user', async () => {
  vi.mocked(requestData).mockResolvedValue({ queriedAt: '2026-10-29T00:00:00Z', upstreamTotal: null, readCount: 1, matchedCount: 1, complete: true, rows: [{ id: 1, basecode: 'TJ', location_info: 'DN00' }] });
  render(<MemoryRouter><IncomingMaterialsPage /></MemoryRouter>);
  await screen.findByText('DN00');
  fireEvent.click(screen.getByRole('button', { name: '基地（多选）' }));
  expect(screen.getByRole('checkbox', { name: '天津' })).toBeTruthy();
  expect(screen.queryByRole('checkbox', { name: '昆山' })).toBeNull();
});

it('shows the report filename and downloads the selected attachment', async () => {
  const path = 'Upload/Tables/Tb_abnormal_incoming_materials/2025/报告,第一版.pptx';
  vi.mocked(requestData).mockResolvedValue({
    queriedAt: '2026-10-29T00:00:00Z', upstreamTotal: 1, readCount: 1, matchedCount: 1, complete: true,
    rows: [{ id: 1, location_info: 'DN00', report_attachment: path, _incomingReports: [{ path, accessToken: 'grant' }] }],
  });
  vi.mocked(apiFetch).mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['data']) } as Response);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:report') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    render(<MemoryRouter><IncomingMaterialsPage /></MemoryRouter>);
    const link = await screen.findByRole('button', { name: '报告,第一版.pptx' });
    expect(link.getAttribute('title')).toBe('报告,第一版.pptx');
    fireEvent.click(link);
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(vi.mocked(apiFetch).mock.lastCall?.[0]).toContain('/incoming-materials/report?');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:report');
  } finally { click.mockRestore(); }
});

it('submits combined filters and rejects an inverted date range', async () => {
  vi.mocked(requestData).mockResolvedValue({
    queriedAt: '2026-10-29T00:00:00Z', upstreamTotal: 1000, readCount: 1000,
    matchedCount: 3, complete: true, rows: [
      { id: 1, basecode: 'TJ', selmatnr: 'MAT-123', supplier: '供应商 A', ebeln: 'PO1', prueflos: 'B1', abnormal_class: '外观', location_info: 'DN00', pastrterm: '2026-10-25 00:00:00' },
      { id: 2, basecode: 'AY', selmatnr: 'MAT-123', supplier: '供应商 B', ebeln: 'PO2', prueflos: 'B2', abnormal_class: '性能', location_info: '9N00', pastrterm: '2026-10-25 00:00:00' },
      { id: 3, basecode: 'KS', selmatnr: 'MAT-456', supplier: '供应商 B', ebeln: 'PO2', prueflos: 'B2', abnormal_class: '性能', location_info: 'KN00', pastrterm: '2026-10-25 00:00:00' },
    ],
  });
  render(<MemoryRouter><IncomingMaterialsPage /></MemoryRouter>);
  await screen.findByText('DN00');
  fireEvent.click(screen.getByRole('button', { name: '基地（多选）' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '天津' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '昆山' }));
  fireEvent.click(screen.getByRole('button', { name: '基地（多选）' }));
  fireEvent.click(screen.getByRole('button', { name: '物料编号（多选）' }));
  fireEvent.change(screen.getByLabelText('搜索物料编号'), { target: { value: '123' } });
  expect(screen.queryByRole('checkbox', { name: 'MAT-456' })).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: 'MAT-123' }));
  fireEvent.click(screen.getByRole('button', { name: '物料编号（多选）' }));
  fireEvent.click(screen.getByRole('button', { name: '供应商（多选）' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '供应商 A' }));
  fireEvent.click(screen.getByRole('button', { name: '供应商（多选）' }));
  for (const [label, option] of [['订单号', 'PO1'], ['检验批号', 'B1'], ['异常分类', '外观']]) {
    fireEvent.click(screen.getByRole('button', { name: `${label}（多选）` }));
    fireEvent.change(screen.getByLabelText(`搜索${label}`), { target: { value: option } });
    fireEvent.click(screen.getByRole('checkbox', { name: option }));
    fireEvent.click(screen.getByRole('button', { name: `${label}（多选）` }));
  }
  fireEvent.click(screen.getByRole('button', { name: '到货日期' }));
  fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-10-20' } });
  fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-10-01' } });
  expect(screen.getByRole('alert').textContent).toContain('开始日期不能晚于结束日期');
  fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-10-31' } });
  fireEvent.click(screen.getByRole('button', { name: '确定' }));
  fireEvent.click(screen.getByRole('button', { name: '筛选数据' }));
  expect(screen.queryByText('9N00')).toBeNull();
  expect(screen.queryByText('KN00')).toBeNull();
  expect(screen.getByText('DN00')).toBeTruthy();
  expect(requestData).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '导出数据' }));
  const workbook = vi.mocked(XLSX.writeFile).mock.lastCall?.[0] as XLSX.WorkBook;
  const exported = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['异常记录明细'], { header: 1 });
  expect(exported).toHaveLength(2);
  expect(exported[0]).toEqual(expect.arrayContaining(['库位信息', '不良图片', '8D报告路径']));
  expect(exported[1]).toContain('DN00');
  expect(exported[1]).not.toContain('KN00');
  expect(await screen.findByText('基地：天津、昆山')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清空' }));
  expect(screen.getByText('9N00')).toBeTruthy();
  expect(requestData).toHaveBeenCalledTimes(1);
});
