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
  fireEvent.click(screen.getByRole('button', { name: '按一级类型筛选：生产缺陷' }));
  expect(await screen.findByText('一级类型：生产缺陷 · 2 条')).toBeTruthy();
  expect(screen.getByRole('button', { name: '按一级类型筛选：生产缺陷' }).getAttribute('aria-pressed')).toBe('true');
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
