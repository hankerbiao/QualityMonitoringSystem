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

it('shows matching details for each distribution and exports the selected records', async () => {
  vi.mocked(requestData).mockResolvedValue({
    queriedAt: '2026-10-29T00:00:00Z', upstreamTotal: 4, readCount: 4, matchedCount: 4, complete: true,
    rows: [
      { id: 1, basecode: 'TJ', abnormal_class: '外观', supplier: '厂商 A', selmatnr: 'MAT-A' },
      { id: 2, basecode: '1000', abnormal_class: '性能', supplier: '厂商 B', selmatnr: 'MAT-B' },
      { id: 3, basecode: 'KS', abnormal_class: '外观', supplier: '厂商 B', selmatnr: 'MAT-C' },
      { id: 4, basecode: 'KS', abnormal_class: '', supplier: '厂商 A ', selmatnr: 'MAT-D' },
    ],
  });
  render(<MemoryRouter><IncomingMaterialsPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: '查看基地分布：天津明细' }));
  let table = screen.getByRole('table');
  expect(within(table).getByText('MAT-A')).toBeTruthy();
  expect(within(table).getByText('MAT-B')).toBeTruthy();
  expect(within(table).queryByText('MAT-C')).toBeNull();
  expect(screen.getByText('基地：天津 · 2 条')).toBeTruthy();
  expect(screen.getByRole('button', { name: '查看基地分布：天津明细' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '查看异常分类：外观明细' }));
  table = screen.getByRole('table');
  expect(within(table).getByText('MAT-C')).toBeTruthy();
  expect(within(table).queryByText('MAT-B')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看厂商分布 TOP 5：厂商 A明细' }));
  expect(within(table).getByText('MAT-D')).toBeTruthy();
  expect(within(table).queryByText('MAT-C')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '导出数据' }));
  const workbook = vi.mocked(XLSX.writeFile).mock.lastCall?.[0] as XLSX.WorkBook;
  const exported = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['异常记录明细'], { header: 1 });
  expect(exported).toHaveLength(3);
  expect(exported[1]).toContain('MAT-A');
  expect(exported[2]).toContain('MAT-D');
  fireEvent.click(screen.getByRole('button', { name: '查看异常分类：—明细' }));
  expect(within(table).getByText('MAT-D')).toBeTruthy();
  expect(within(table).queryByText('MAT-A')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '清除明细筛选' }));
  expect(within(table).getByText('MAT-A')).toBeTruthy();
  expect(within(table).getByText('MAT-C')).toBeTruthy();
  expect(requestData).toHaveBeenCalledTimes(1);
});

it('expands and collapses each distribution independently for the filtered results', async () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({
    id: index, basecode: `BASE${index + 1}`, abnormal_class: `分类${index + 1}`,
    supplier: `厂商${index + 1}`, selmatnr: index < 6 ? 'MATCH' : 'OTHER',
  }));
  vi.mocked(requestData).mockResolvedValue({ queriedAt: '2026-10-29T00:00:00Z', upstreamTotal: 7, readCount: 7, matchedCount: 7, complete: true, rows });
  render(<MemoryRouter><IncomingMaterialsPage /></MemoryRouter>);
  await screen.findByRole('heading', { name: '基地分布' });
  for (const [title, sixth] of [['基地分布', 'BASE6'], ['异常分类', '分类6'], ['厂商分布 TOP 5', '厂商6']]) {
    const button = screen.getByRole('button', { name: `展开更多${title}` });
    const card = button.parentElement!.parentElement!;
    expect(within(card).queryByTitle(sixth)).toBeNull();
    fireEvent.click(button);
    expect(within(card).getByTitle(sixth)).toBeTruthy();
    expect(screen.getByRole('button', { name: `收起${title}` }).getAttribute('aria-expanded')).toBe('true');
  }
  fireEvent.click(screen.getByRole('button', { name: '收起基地分布' }));
  expect(screen.getByRole('button', { name: '展开更多基地分布' }).getAttribute('aria-expanded')).toBe('false');
  expect(screen.getByRole('button', { name: '收起异常分类' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '查看厂商分布 TOP 5：厂商6明细' }));
  expect(screen.getByText('供应商：厂商6 · 1 条')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('关键词（搜索所有字段）'), { target: { value: 'MATCH' } });
  fireEvent.click(screen.getByRole('button', { name: '筛选数据' }));
  expect(screen.queryByText('供应商：厂商6 · 1 条')).toBeNull();
  const supplierCard = screen.getByRole('button', { name: '收起厂商分布 TOP 5' }).parentElement!.parentElement!;
  expect(within(supplierCard).getByTitle('厂商6')).toBeTruthy();
  expect(within(supplierCard).queryByTitle('厂商7')).toBeNull();
  fireEvent.click(within(supplierCard).getByRole('button', { name: '查看厂商分布 TOP 5：厂商6明细' }));
  expect(screen.getByText('供应商：厂商6 · 1 条')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '收起厂商分布 TOP 5' }));
  expect(within(supplierCard).queryByTitle('厂商6')).toBeNull();
  expect(requestData).toHaveBeenCalledTimes(1);
});

it('ranks the top five suppliers by filtered abnormal record count', async () => {
  const suppliers = ['甲', '甲 ', '甲', '甲', '甲', '甲', '乙', '乙', '乙', '乙', '乙', '丙', '丙', '丙', '丙', '丁', '丁', '丁', '戊', '戊', '己', ''];
  vi.mocked(requestData).mockResolvedValue({
    queriedAt: '2026-10-29T00:00:00Z', upstreamTotal: suppliers.length, readCount: suppliers.length,
    matchedCount: suppliers.length, complete: true,
    rows: suppliers.map((supplier, index) => ({ id: index, supplier, basecode: index < 6 ? 'TJ' : 'KS' })),
  });
  render(<MemoryRouter><IncomingMaterialsPage /></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: '来料质量' })).toBeTruthy();
  const chart = screen.getByRole('heading', { name: '厂商分布 TOP 5' }).closest('div')?.parentElement?.parentElement;
  expect(chart).toBeTruthy();
  const labels = within(chart as HTMLElement).getAllByTitle(/.+/).map(item => item.textContent);
  expect(labels).toEqual(['甲', '乙', '丙', '丁', '戊']);
  expect(within(chart as HTMLElement).getByText('6')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '基地（多选）' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '天津' }));
  fireEvent.click(screen.getByRole('button', { name: '基地（多选）' }));
  fireEvent.click(screen.getByRole('button', { name: '筛选数据' }));
  expect(within(chart as HTMLElement).getAllByTitle(/.+/).map(item => item.textContent)).toEqual(['甲']);
  expect(within(chart as HTMLElement).getByText('6')).toBeTruthy();
});

it('filters and clears loaded data without requesting the upstream again', async () => {
  vi.mocked(requestData).mockResolvedValue({
    queriedAt: '2026-10-29T00:00:00Z', upstreamTotal: 1000, readCount: 1000,
    matchedCount: 2, complete: true,
    rows: [{ id: 1, location_info: 'DN00', selmatnr: 'ABC' }, { id: 2, location_info: '9N00', selmatnr: 'XYZ' }],
  });
  render(<MemoryRouter><IncomingMaterialsPage /></MemoryRouter>);
  expect(await screen.findByText('DN00')).toBeTruthy();
  expect(screen.getByText('已读取全部上游分页')).toBeTruthy();
  expect(screen.queryByText('库位匹配 *N00')).toBeNull();
  expect(screen.queryByText('仅显示库位信息以 N00 结尾的记录，如 DN00、9N00。')).toBeNull();
  expect(screen.queryByText(/点击详情查看完整字段/)).toBeNull();
  expect(screen.queryByText('上游总记录')).toBeNull();
  expect(screen.queryByText('已读取记录')).toBeNull();
  expect(screen.queryByText('符合 N00 库位')).toBeNull();
  expect(screen.queryByText('覆盖范围')).toBeNull();
  expect(screen.getByText('XYZ')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('关键词（搜索所有字段）'), { target: { value: 'ABC' } });
  fireEvent.click(screen.getByRole('button', { name: '筛选数据' }));
  expect(screen.queryByText('XYZ')).toBeNull();
  expect(screen.getByText('DN00')).toBeTruthy();
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

it('downloads every image in a record through the authenticated image endpoint', async () => {
  const photos = [
    { path: 'Upload/Tables/Tb_abnormal_incoming_materials/第一张.jpg', accessToken: 'grant1' },
    { path: 'Upload/Tables/Tb_abnormal_incoming_materials/第二张.png', accessToken: 'grant2' },
  ];
  vi.mocked(requestData).mockResolvedValue({ queriedAt: '2026-10-29T00:00:00Z', upstreamTotal: 1, readCount: 1, matchedCount: 1, complete: true, rows: [{ id: 1, _incomingPhotos: photos }] });
  vi.mocked(apiFetch).mockResolvedValue({ ok: true, blob: async () => new Blob(['image']) } as Response);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:download') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  const filenames: string[] = [];
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filenames.push(this.download); });
  try {
    render(<MemoryRouter><IncomingMaterialsPage /></MemoryRouter>);
    const download = await screen.findByRole('button', { name: '下载图片' });
    await screen.findByRole('img', { name: '不良图片 2' });
    vi.mocked(apiFetch).mockClear();
    fireEvent.click(download);
    await waitFor(() => expect(filenames).toEqual(['第一张.jpg', '第二张.png']));
    expect(vi.mocked(apiFetch).mock.calls.map(([url]) => String(url))).toEqual(photos.map(photo => expect.stringContaining(new URLSearchParams(photo).toString())));
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: '查看第 1 张不良图片' })).toBeTruthy();
  } finally { click.mockRestore(); vi.mocked(apiFetch).mockReset().mockResolvedValue({ ok: false } as Response); }
});

it('reports partial image download failures and allows retry', async () => {
  const photos = [
    { path: 'Upload/Tables/Tb_abnormal_incoming_materials/a.jpg', accessToken: 'a' },
    { path: 'Upload/Tables/Tb_abnormal_incoming_materials/b.jpg', accessToken: 'b' },
  ];
  vi.mocked(requestData).mockResolvedValue({ queriedAt: '2026-10-29T00:00:00Z', upstreamTotal: 1, readCount: 1, matchedCount: 1, complete: true, rows: [{ id: 1, _incomingPhotos: photos }] });
  vi.mocked(apiFetch).mockResolvedValue({ ok: true, blob: async () => new Blob(['image']) } as Response);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:download') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    render(<MemoryRouter><IncomingMaterialsPage /></MemoryRouter>);
    await screen.findByRole('img', { name: '不良图片 2' });
    vi.mocked(apiFetch).mockResolvedValueOnce({ ok: true, blob: async () => new Blob(['image']) } as Response).mockResolvedValueOnce({ ok: false } as Response);
    fireEvent.click(screen.getByRole('button', { name: '下载图片' }));
    expect((await screen.findByRole('alert')).textContent).toContain('已下载 1 张');
    expect((screen.getByRole('button', { name: '下载图片' }) as HTMLButtonElement).disabled).toBe(false);
  } finally { click.mockRestore(); vi.mocked(apiFetch).mockReset().mockResolvedValue({ ok: false } as Response); }
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
    '序号', '检验批号', '物料编号', '物料描述', '到货数量', '供应商', '供应商代码', '库位信息', '到货日期', '订单号',
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
