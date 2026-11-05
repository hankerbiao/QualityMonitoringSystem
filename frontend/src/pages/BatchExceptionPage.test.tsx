// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { requestData } from '../api/authApi';
import BatchExceptionPage from './BatchExceptionPage';

const authState = vi.hoisted(() => ({ basePermissions: null as string[] | null }));

vi.mock('../api/authApi', () => ({ requestData: vi.fn() }));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'user', basePermissions: authState.basePermissions, dashboardPermissions: ['batch-exception'] } }),
}));
vi.mock('xlsx', async (importOriginal) => ({ ...await importOriginal<typeof import('xlsx')>(), writeFile: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  authState.basePermissions = null;
});

const rows = [
  {
    id: 'a1', factory: '天津', state: 'Open', models: '6210 C2', orderID: 30238291,
    salesReceipts: '0041003306', materialSn: 'SN-001', errTypeFirst: '生产缺陷', errTypeSecond: '人为失误',
    errNum: 33, productionCount: 33, productionGrade: '一般', causedBy: '客户',
    createTime: '2026-10-22 17:58:39', errDesc: '老化测试批量失败',
  },
  {
    id: 'a2', factory: '天津', state: 'Closed', models: '6210 C2', orderID: 10350114,
    salesReceipts: '0040004079', materialSn: 'SN-002', errTypeFirst: '物料缺陷', errTypeSecond: '来料品质',
    errNum: 5, productionCount: 63, productionGrade: '重大', causedBy: '供应商',
    createTime: '2026-10-10 08:54:12', errDesc: '线缆接触不良',
  },
  {
    id: 'a3', factory: '昆山', state: 'Closed', models: '6615 X23', orderID: 10349872,
    salesReceipts: 'XBBJ260370', materialSn: 'SN-003', errTypeFirst: '生产缺陷', errTypeSecond: '人为失误',
    errNum: 4, productionCount: 56, productionGrade: '', causedBy: '客户',
    createTime: '2026-10-06 09:48:49', errDesc: '直通率不达标',
  },
  {
    id: 'a4', factory: '昆山', state: 'Open', models: '6615 X23', orderID: 10349999,
    salesReceipts: 'XBBJ260371', materialSn: 'SN-004', errTypeFirst: '', errTypeSecond: '',
    errNum: 8, productionCount: 40, productionGrade: '提示', causedBy: '',
    createTime: '2026-10-07 10:00:00', errDesc: '老化超时',
  },
];

const optionsResult = {
  factories: [
    { value: '', label: '全部基地' },
    { value: '1000', label: '天津' },
    { value: '3000', label: '昆山' },
  ],
  errTypes: { 生产缺陷: ['人为失误'], 物料缺陷: ['来料品质'] },
  models: ['6210 C2', '6615 X23'],
  causedBy: ['客户', '供应商'],
  orders: ['30238291', '10350114'],
  salesReceipts: ['0041003306'],
  states: [
    { value: 'Open', label: '未关闭' },
    { value: 'Closed', label: '已关闭' },
  ],
};

const FACTORY_NAMES: Record<string, string> = { '1000': '天津', '3000': '昆山' };

// 按 URL 参数在测试内模拟上游过滤行为
function mockUpstream() {
  vi.mocked(requestData).mockImplementation(async (url: string) => {
    const text = String(url);
    if (text.includes('/options')) return optionsResult;
    const params = new URLSearchParams(text.split('?')[1] ?? '');
    const factory = params.get('factory');
    const filtered = rows.filter((row) =>
      (!factory || row.factory === FACTORY_NAMES[factory]) &&
      (!params.get('state') || row.state === params.get('state')) &&
      (!params.get('errTypeFirst') || row.errTypeFirst === params.get('errTypeFirst')) &&
      (!params.get('models') || row.models === params.get('models')) &&
      (!params.get('causedBy') || row.causedBy.includes(params.get('causedBy')!)),
    );
    return {
      upstreamTotal: filtered.length,
      readCount: filtered.length,
      complete: true,
      queriedAt: '2026-11-03T00:00:00+08:00',
      sync: { year: 2026, fetched: rows.length, inserted: rows.length, syncedAt: '2026-11-03T00:00:00+08:00', cached: false },
      rows: filtered,
    };
  });
}

const queryUrls = () =>
  vi.mocked(requestData).mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.includes('/batch-exception/query?'));
const optionUrls = () =>
  vi.mocked(requestData).mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.includes('/batch-exception/options'));

it('changes detail page size and keeps table headings in the scroll region', async () => {
  const manyRows = Array.from({ length: 12 }, (_, index) => ({ ...rows[0], id: `row-${index}`, sequence: index + 1, materialSn: `PN-${index + 1}` }));
  vi.mocked(requestData).mockImplementation(async (url: string) => String(url).includes('/options') ? optionsResult : {
    upstreamTotal: 12, readCount: 12, complete: true, queriedAt: '2026-11-03T00:00:00+08:00', rows: manyRows,
    sync: { year: 2026, fetched: 12, inserted: 12, syncedAt: '2026-11-03T00:00:00+08:00', cached: false },
  });
  render(<MemoryRouter><BatchExceptionPage /></MemoryRouter>);
  await screen.findByText('PN-12');
  fireEvent.change(screen.getByLabelText('每页'), { target: { value: '5' } });
  const region = screen.getByRole('region', { name: '批次异常记录明细表' });
  expect(within(region).getByText('PN-5')).toBeTruthy();
  expect(within(region).queryByText('PN-6')).toBeNull();
  expect(region.querySelector('thead')?.classList.contains('sticky')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  expect(within(region).getByText('PN-6')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('每页'), { target: { value: '10' } });
  expect(within(region).getByText('PN-1')).toBeTruthy();
});

it('queries upstream with default range, shows stats and opens detail', async () => {
  mockUpstream();
  render(<MemoryRouter><BatchExceptionPage /></MemoryRouter>);

  expect(await screen.findByText('SN-001')).toBeTruthy();
  await waitFor(() => expect(queryUrls()).toHaveLength(1));
  const url = queryUrls()[0];
  expect(url).toContain('createTimeStart=');
  expect(url).toContain('createTimeEnd=');
  expect(url).not.toContain('state='); // 未设置的条件不下发
  await waitFor(() => expect(optionUrls()).toHaveLength(1));
  expect(optionUrls()[0]).toContain('factory=');

  fireEvent.click(screen.getAllByRole('button', { name: '详情' })[0]);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('批次异常详情')).toBeTruthy();
  expect(within(dialog).getByText('老化测试批量失败')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭详情' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('drills down locally, applies form filters to the query and exports rows', async () => {
  mockUpstream();
  render(<MemoryRouter><BatchExceptionPage /></MemoryRouter>);
  expect(await screen.findByText('SN-001')).toBeTruthy();

  // 分布卡下钻：本地过滤明细，不追加新的上游查询
  fireEvent.click(screen.getByRole('button', { name: '生产缺陷2' }));
  expect(await screen.findByText('批次类别：生产缺陷 · 2 条')).toBeTruthy();
  expect(screen.getByText('SN-001')).toBeTruthy();
  expect(screen.queryByText('SN-002')).toBeNull();
  expect(queryUrls()).toHaveLength(1);

  fireEvent.click(screen.getByRole('button', { name: '清除明细筛选' }));
  expect(await screen.findByText('SN-002')).toBeTruthy();
  expect(queryUrls()).toHaveLength(1);

  // 表单条件：处理状态 → 作为查询参数下发上游
  fireEvent.change(screen.getByLabelText('处理状态'), { target: { value: 'Open' } });
  fireEvent.click(screen.getByRole('button', { name: '查询' }));
  await waitFor(() => expect(queryUrls().some((url) => url.includes('state=Open'))).toBe(true));
  expect(await screen.findByText('SN-004')).toBeTruthy();
  expect(screen.queryByText('SN-002')).toBeNull();

  // 导出当前筛选结果（表头 + 2 条 Open 记录）
  fireEvent.click(screen.getByRole('button', { name: '导出数据' }));
  expect(vi.mocked(XLSX.writeFile)).toHaveBeenCalledWith(expect.anything(), '批次异常明细.xlsx');
  const workbook = vi.mocked(XLSX.writeFile).mock.lastCall?.[0] as XLSX.WorkBook;
  const exported = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets['批次异常明细'], { header: 1 });
  expect(exported[0]).toContain('异常描述');
  expect(exported).toHaveLength(3);
});

it('locks restricted users to their allowed factory', async () => {
  authState.basePermissions = ['TJ'];
  mockUpstream();
  render(<MemoryRouter><BatchExceptionPage /></MemoryRouter>);
  expect(await screen.findByText('SN-001')).toBeTruthy();
  await waitFor(() => expect(queryUrls()).toHaveLength(1));
  expect(queryUrls()[0]).toContain('factory=1000');
  await waitFor(() => expect(optionUrls()).toHaveLength(1));
  expect(optionUrls()[0]).toContain('factory=1000');
  expect((screen.getByLabelText('基地') as HTMLSelectElement).value).toBe('1000');
  // 天津工厂只有 2 条记录
  expect(screen.queryByText('SN-003')).toBeNull();
});

// 带序号的行，9004 已合并到 9001（锚点行）
const sequenceRows = [
  {
    sequence: 9001, factory: '天津', state: 'Open', models: '6210 C2', orderID: 30238291,
    salesReceipts: '0041003306', materialSn: 'SN-M1', errTypeFirst: '生产缺陷', errTypeSecond: '',
    errNum: 1, productionCount: 10, productionGrade: '', causedBy: '客户', createTime: '2026-10-01 10:00:00',
  },
  {
    sequence: 9002, factory: '天津', state: 'Closed', models: '6210 C2', orderID: 30238292,
    salesReceipts: '0041003307', materialSn: 'SN-M2', errTypeFirst: '物料缺陷', errTypeSecond: '',
    errNum: 2, productionCount: 20, productionGrade: '', causedBy: '供应商', createTime: '2026-10-02 10:00:00',
  },
  {
    sequence: 9003, factory: '昆山', state: 'Closed', models: '6615 X23', orderID: 10349872,
    salesReceipts: 'XBBJ260370', materialSn: 'SN-M3', errTypeFirst: '生产缺陷', errTypeSecond: '',
    errNum: 3, productionCount: 30, productionGrade: '', causedBy: '客户', createTime: '2026-10-03 10:00:00',
  },
  {
    sequence: 9004, factory: '昆山', state: 'Open', models: '6615 X23', orderID: 10349999,
    salesReceipts: 'XBBJ260371', materialSn: 'SN-M4', errTypeFirst: '生产缺陷', errTypeSecond: '',
    errNum: 4, productionCount: 40, productionGrade: '', causedBy: '客户', createTime: '2026-10-04 10:00:00',
    mergedInto: 9001,
  },
];

let lastMutation: { url: string; body: unknown } | null = null;

function mockQueryRows(rows: Record<string, unknown>[]) {
  lastMutation = null;
  vi.mocked(requestData).mockImplementation(async (url: string, init?: RequestInit) => {
    const text = String(url);
    if (text.includes('/options')) return optionsResult;
    if (text.includes('/unmerge') || text.includes('/merge')) {
      lastMutation = { url: text, body: init?.body ? JSON.parse(String(init.body)) : null };
      return { anchor: 9001, merged: 2 };
    }
    return {
      upstreamTotal: rows.length,
      readCount: rows.length,
      complete: true,
      queriedAt: '2026-11-03T00:00:00+08:00',
      sync: { year: 2026, fetched: rows.length, inserted: 0, syncedAt: '2026-11-03T00:00:00+08:00', cached: true },
      rows,
    };
  });
}

it('renders merged groups with a combined sequence cell and counts statistics rows', async () => {
  mockQueryRows(sequenceRows);
  render(<MemoryRouter><BatchExceptionPage /></MemoryRouter>);
  expect(await screen.findByText('SN-M1')).toBeTruthy();

  // 4 条记录合并后按统计单元计数：3 条
  expect(screen.getByText('3 条')).toBeTruthy();
  // 锚点行带合并标记，组员序号不再单独展示，其余内容仍逐行展示
  expect(screen.getByText('合并 2 条')).toBeTruthy();
  expect(screen.queryByText('9004')).toBeNull();
  expect(screen.getByText('9001')).toBeTruthy();
  expect(screen.getByText('SN-M4')).toBeTruthy();

  // 导出保持全部物理行，序号列写 Excel 合并单元格
  fireEvent.click(screen.getByRole('button', { name: '导出数据' }));
  const workbook = vi.mocked(XLSX.writeFile).mock.lastCall?.[0] as XLSX.WorkBook;
  const sheet = workbook.Sheets['批次异常明细'];
  expect(sheet['!merges']).toEqual([{ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }]);
  const exported = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
  expect(exported).toHaveLength(5);
});

it('merges selected records through the merge dialog', async () => {
  mockQueryRows(sequenceRows);
  render(<MemoryRouter><BatchExceptionPage /></MemoryRouter>);
  expect(await screen.findByText('SN-M1')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: '编辑模式' }));
  fireEvent.click(screen.getByLabelText('选择序号 9001'));
  fireEvent.click(screen.getByLabelText('选择序号 9002'));
  fireEvent.click(screen.getByRole('button', { name: '合并统计' }));

  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('合并统计')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: '确认合并' }));

  await waitFor(() => expect(lastMutation?.url).toContain('/batch-exception/merge'));
  expect(lastMutation?.body).toEqual({ sequences: [9001, 9002] });
  await waitFor(() => expect(queryUrls()).toHaveLength(2));
});

it('dissolves a merged group from the anchor row in edit mode', async () => {
  mockQueryRows(sequenceRows);
  render(<MemoryRouter><BatchExceptionPage /></MemoryRouter>);
  expect(await screen.findByText('SN-M1')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: '编辑模式' }));
  fireEvent.click(screen.getByRole('button', { name: '解散' }));

  await waitFor(() => expect(lastMutation?.url).toContain('/batch-exception/unmerge'));
  expect(lastMutation?.body).toEqual({ sequence: 9001 });
});
