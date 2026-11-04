import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BarChart3, BellRing, ChevronLeft, ChevronRight, Download, FileSearch, ListFilter, RotateCcw, X } from 'lucide-react';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import * as XLSX from 'xlsx';
import { useNavigate } from 'react-router-dom';
import { clearLrrApiCache, lrrApi } from '../api/lrrApi';
import LRRFiltersPanel from '../components/lrr/LRRFilters';
import { DashboardSwitcher } from '../components/shared/DashboardSwitcher';
import { HelpTooltip } from '../components/shared/HelpTooltip';
import { LoadingSpinner } from '../components/ui';
import { ApiRequestError } from '../api/authApi';
import type { LRRData, LRRFaultDetail, LRRFilteredOrdersResponse, LRRFilters, LRRListResponse, LRRMaterialRank, LRRTrendPoint, LRRUsageDetailsResponse } from '../types';
import { displayMaterialNumber } from '../utils/lrr';

const PAGE_SIZE = 50;
const EMPTY_FILTERS: LRRFilters = { sortBy: 'month', sortDir: 'asc' };
const FILTER_KEYS: Array<keyof LRRFilters> = [
  'plannedDateFrom',
  'plannedDateTo',
  'ngDateFrom',
  'ngDateTo',
  'materialNumber',
  'productModels',
  'bases',
  'customerIds',
  'orderTypes',
  'serialNumbers', 'productionOrders', 'salesOrders',
  'month',
];
const hasSearchCriteria = (candidate: LRRFilters) => FILTER_KEYS.some((key) => {
  const value = candidate[key];
  return Array.isArray(value) ? value.some((item) => Boolean(item?.trim())) : Boolean(value);
});
const filtersKey = (candidate: LRRFilters) => JSON.stringify({
  ...candidate,
  customerIds: [...(candidate.customerIds ?? [])].sort(),
  productModels: [...(candidate.productModels ?? [])].sort(),
  bases: [...(candidate.bases ?? [])].sort(),
  orderTypes: [...(candidate.orderTypes ?? [])].sort(),
  serialNumbers: [...(candidate.serialNumbers ?? [])].sort(),
  productionOrders: [...(candidate.productionOrders ?? [])].sort(),
  salesOrders: [...(candidate.salesOrders ?? [])].sort(),
});

function plannedMonthBounds(month: string): { from: string; to: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) return null;
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    from: `${match[1]}-${match[2]}-01`,
    to: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`,
  };
}
const rateClass = (rate: number | null) => rate === null ? 'bg-slate-50 text-slate-400' : rate < 2 ? 'bg-emerald-50 text-emerald-800' : rate < 5 ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-800';
const rateText = (rate: number | null | undefined) => rate == null ? 'text-slate-400' : rate < 2 ? 'text-emerald-700' : rate < 5 ? 'text-amber-700' : 'text-red-700';

function formatCount(value: number | null | undefined): string {
  return value == null ? '-' : value.toLocaleString('zh-CN');
}

function normalizeApiError(error: unknown): ApiRequestError {
  if (error instanceof ApiRequestError) return error;
  return new ApiRequestError('查询失败，请稍后重试', { code: 'INTERNAL_ERROR', retryable: true });
}

function errorMessage(error: ApiRequestError): string {
  switch (error.code) {
    case 'QUERY_TOO_LARGE':
      return error.message || '当前查询范围过大，请缩小日期或增加筛选条件';
    case 'DATA_GATEWAY_TIMEOUT':
      return error.message || '生产数据源响应超时，请缩小查询范围后重试';
    case 'DATA_GATEWAY_UNAVAILABLE':
    case 'NETWORK_ERROR':
      return error.message || '生产数据源暂时不可用，请稍后重试';
    case 'AUTH_REQUIRED':
      return '登录状态已过期，请重新登录';
    default:
      return error.message || 'LRR 查询失败，请稍后重试';
  }
}

function ErrorBanner({ error, onRetry }: { error: ApiRequestError; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-t border-red-200 bg-red-50 px-5 py-2.5 text-xs text-red-700">
      <div>
        <p>{errorMessage(error)}</p>
        {error.requestId && <p className="mt-1 text-[11px] text-red-500">请求编号：{error.requestId}</p>}
      </div>
      {onRetry && error.retryable && (
        <button type="button" onClick={onRetry} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 font-medium text-red-700 hover:bg-red-100">
          <RotateCcw className="size-3.5" />重试
        </button>
      )}
    </div>
  );
}

const DETAIL_COLUMNS = [
  ['matchedModel', '计入机型'], ['sn', '维修记录SN'], ['salesOrder', '销售订单'],
  ['productionOrder', '维修记录订单'], ['faultPhenomenon', '故障现象'], ['repairAction', '维修措施'],
  ['station', '故障工站'], ['repairPerson', '维修人员'], ['repairTime', '维修时间'],
] as const;

export function DetailModal({ title, items, loading, error, onClose }: { title: string; items: LRRFaultDetail[]; loading: boolean; error: ApiRequestError | null; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [exportError, setExportError] = useState('');
  useEffect(() => {
    closeRef.current?.focus();
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);
  const exportDetails = () => {
    try {
      const sheet = XLSX.utils.aoa_to_sheet([
        DETAIL_COLUMNS.map(([, label]) => label),
        ...items.map(item => DETAIL_COLUMNS.map(([key]) => item[key] || '')),
      ]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, '维修故障明细');
      XLSX.writeFile(workbook, `${title.replace(/[\\/:*?"<>|]/g, '_')}_维修明细.xlsx`);
      setExportError('');
    } catch {
      setExportError('明细导出失败，请重试');
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="lrr-detail-title" aria-busy={loading} className="flex max-h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-md bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2"><FileSearch className="size-4 text-cyan-600" /><h2 id="lrr-detail-title" className="text-sm font-semibold text-slate-900">{title}</h2></div>
          <button ref={closeRef} type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-200" aria-label="关闭"><X className="size-4" /></button>
        </div>
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-2">
          <span className="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white">维修 SN</span>
          <span className="mx-1 h-5 border-l border-slate-200" />
          <button type="button" onClick={exportDetails} disabled={loading || !!error || !items.length} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Download className="size-3.5" />导出维修 SN</button>
        </div>
        {exportError && <p role="alert" className="px-5 pt-3 text-xs text-red-600">{exportError}</p>}
        {loading ? <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-sm text-slate-500"><LoadingSpinner size="md" />正在加载故障明细...</div> : error ? (
          <div role="alert" className="flex min-h-48 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-red-700">
            <p>{errorMessage(error)}</p>
            {error.requestId && <p className="text-xs text-slate-400">请求编号：{error.requestId}</p>}
          </div>
        ) : (
          <div className="overflow-auto p-4">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>{DETAIL_COLUMNS.map(([, label]) => <th key={label} className="px-3 py-2 font-semibold">{label}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item, index) => (
                  <tr key={`${item.materialNumber}-${item.sn}-${index}`} className="text-slate-700 hover:bg-slate-50">
                    {DETAIL_COLUMNS.map(([key]) => <td key={key} className="max-w-64 px-3 py-2" title={item[key] || ''}>{item[key] || '-'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {!items.length && <p className="px-4 py-12 text-center text-sm text-slate-400">暂无故障明细</p>}
          </div>
        )}
        <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">共 {items.length.toLocaleString('zh-CN')} 条记录</div>
      </div>
    </div>
  );
}

const USAGE_COLUMNS = [
  ['productionOrder', '生产订单'],
  ['salesOrder', '销售订单'],
  ['productModel', '机型'],
  ['base', '库位'],
  ['plannedQuantity', '计划整机数量'],
  ['issuedQuantity', '261 发料'],
  ['returnedQuantity', '262 退料'],
  ['usageQuantity', '净使用量'],
] as const;

function UsageDetailsModal({
  title,
  response,
  loading,
  error,
  onClose,
}: {
  title: string;
  response: LRRUsageDetailsResponse | null;
  loading: boolean;
  error: ApiRequestError | null;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [exportError, setExportError] = useState('');
  const items = response?.items ?? [];
  const usageColumns = response?.quantityMode === 'legacy'
    ? [
        ...USAGE_COLUMNS.slice(0, 5),
        ['usageQuantity', '历史使用量'] as const,
      ]
    : USAGE_COLUMNS;
  const exportColumns = [
    ...usageColumns.slice(0, 2),
    ['materialNumber', '物料号'] as const,
    ['materialDescription', '物料描述'] as const,
    ...usageColumns.slice(2),
  ];
  const usageColumnWidths: Record<string, string> = response?.quantityMode === 'legacy'
    ? {
        productionOrder: '20%',
        salesOrder: '18%',
        productModel: '14%',
        base: '10%',
        plannedQuantity: '18%',
        usageQuantity: '20%',
      }
    : {
        productionOrder: '16%',
        salesOrder: '15%',
        productModel: '13%',
        base: '9%',
        plannedQuantity: '12%',
        issuedQuantity: '11%',
        returnedQuantity: '11%',
        usageQuantity: '13%',
      };
  useEffect(() => {
    closeRef.current?.focus();
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);
  const exportDetails = () => {
    try {
      const sheet = XLSX.utils.aoa_to_sheet([
        exportColumns.map(([, label]) => label),
        ...items.map(item => exportColumns.map(([key]) => item[key])),
      ]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, '订单使用数量');
      XLSX.writeFile(workbook, `${title.replace(/[\\/:*?"<>|]/g, '_')}_订单使用数量.xlsx`);
      setExportError('');
    } catch {
      setExportError('订单使用数量导出失败，请重试');
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="lrr-usage-title" aria-busy={loading} className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-md bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div><h2 id="lrr-usage-title" className="text-sm font-semibold text-slate-900">{title}</h2><p className="mt-1 text-xs text-slate-500">按生产订单汇总；{response?.quantityMode === 'legacy' ? '上游未提供移动类型，沿用 LRR 历史数量口径' : '净使用量 = 261 发料 - 262 退料'}</p></div>
          <button ref={closeRef} type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-200" aria-label="关闭"><X className="size-4" /></button>
        </div>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-2">
          <div className="flex flex-wrap gap-4 text-xs text-slate-600">
            <span>订单数 <b className="font-mono text-slate-900">{formatCount(response?.total)}</b></span>
            {response?.quantityMode === 'legacy' ? (
              <span>历史使用量 <b className="font-mono text-cyan-800">{formatCount(response.usageQuantity)}</b></span>
            ) : (
              <>
                <span>发料 <b className="font-mono text-slate-900">{formatCount(response?.issuedQuantity)}</b></span>
                <span>退料 <b className="font-mono text-slate-900">{formatCount(response?.returnedQuantity)}</b></span>
                <span>净使用 <b className="font-mono text-cyan-800">{formatCount(response?.usageQuantity)}</b></span>
              </>
            )}
          </div>
          <button type="button" onClick={exportDetails} disabled={loading || !!error || !items.length} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Download className="size-3.5" />导出</button>
        </div>
        {exportError && <p role="alert" className="px-5 pt-3 text-xs text-red-600">{exportError}</p>}
        {loading ? <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-sm text-slate-500"><LoadingSpinner size="md" />正在汇总订单使用数量...</div> : error ? (
          <div role="alert" className="flex min-h-48 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-red-700">
            <p>{errorMessage(error)}</p>
            {error.requestId && <p className="text-xs text-slate-400">请求编号：{error.requestId}</p>}
          </div>
        ) : (
          <div className="overflow-auto p-4">
            <table className="w-full min-w-[980px] table-fixed text-center text-xs">
              <colgroup>{usageColumns.map(([key]) => <col key={key} style={{ width: usageColumnWidths[key] }} />)}</colgroup>
              <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>{usageColumns.map(([, label]) => <th key={label} className="whitespace-nowrap px-3 py-2 font-semibold">{label}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item, index) => (
                  <tr key={`${item.productionOrder}-${item.salesOrder}-${index}`} className="text-slate-700 hover:bg-slate-50">
                    {usageColumns.map(([key]) => (
                      <td key={key} className={`overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 ${key.endsWith('Quantity') ? 'font-mono tabular-nums' : ''}`} title={String(item[key] ?? '')}>
                        {key.endsWith('Quantity') ? formatCount(item[key] as number) : item[key] || '-'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!items.length && <p className="px-4 py-12 text-center text-sm text-slate-400">当前筛选范围没有订单使用记录</p>}
          </div>
        )}
        <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">{response?.quantityMode === 'legacy' ? '历史使用量' : '净使用数量'}合计 {formatCount(response?.usageQuantity)}</div>
      </div>
    </div>
  );
}

function FilteredOrdersModal({
  response,
  loading,
  error,
  onClose,
  onPageChange,
}: {
  response: LRRFilteredOrdersResponse | null;
  loading: boolean;
  error: ApiRequestError | null;
  onClose: () => void;
  onPageChange: (page: number) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const items = response?.items ?? [];
  const totalPages = Math.max(1, Math.ceil((response?.total ?? 0) / (response?.limit || 50)));
  useEffect(() => {
    closeRef.current?.focus();
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="lrr-filtered-orders-title" aria-busy={loading} className="flex max-h-[88vh] w-full max-w-7xl flex-col overflow-hidden rounded-md bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2"><ListFilter className="size-4 text-cyan-600" /><div><h2 id="lrr-filtered-orders-title" className="text-sm font-semibold text-slate-900">被过滤订单</h2><p className="mt-1 text-xs text-slate-500">因订单状态或订单类型被过滤的过账记录</p></div></div>
          <button ref={closeRef} type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-200" aria-label="关闭"><X className="size-4" /></button>
        </div>
        {loading ? <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-sm text-slate-500"><LoadingSpinner size="md" />正在加载被过滤订单...</div> : error ? (
          <div role="alert" className="flex min-h-48 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-red-700">
            <p>{errorMessage(error)}</p>
            {error.requestId && <p className="text-xs text-slate-400">请求编号：{error.requestId}</p>}
          </div>
        ) : (
          <div className="overflow-auto p-4">
            <table className="w-full min-w-[1500px] text-left text-xs">
              <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>{['生产订单', '销售订单', '物料 PN', '物料描述', '机型', '基地', '计划日期', '移动类型', '数量', '订单状态', '订单类型', 'CXFLG', '过滤原因'].map((label) => <th key={label} className="whitespace-nowrap px-3 py-2 font-semibold">{label}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.id} className="text-slate-700 hover:bg-slate-50">
                    <td className="whitespace-nowrap px-3 py-2 font-mono">{item.productionOrder || '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono">{item.salesOrder || '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono">{displayMaterialNumber(item.materialNumber) || '-'}</td>
                    <td className="max-w-56 truncate px-3 py-2" title={item.materialDescription}>{item.materialDescription || '-'}</td>
                    <td className="max-w-44 truncate px-3 py-2" title={item.productModel}>{item.productModel || '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2">{item.base || '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono">{item.plannedDate || '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono">{item.movementType || '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono">{item.quantity == null ? '-' : formatCount(item.quantity)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{item.orderStatus || '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2">{item.orderType || '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono">{item.reversalFlag || '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-red-700">{item.exclusionReasons.join('；')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!items.length && <p className="px-4 py-12 text-center text-sm text-slate-400">当前筛选范围没有被过滤的订单</p>}
          </div>
        )}
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          <span>共 {formatCount(response?.total ?? 0)} 条，第 {response?.page ?? 1} / {totalPages} 页</span>
          <div className="flex gap-1">
            <button type="button" onClick={() => onPageChange(Math.max(1, (response?.page ?? 1) - 1))} disabled={loading || !response || (response.page ?? 1) <= 1} className="inline-flex size-8 items-center justify-center rounded-md border border-slate-300 bg-white disabled:opacity-40" aria-label="上一页"><ChevronLeft className="size-3.5" /></button>
            <button type="button" onClick={() => onPageChange(Math.min(totalPages, (response?.page ?? 1) + 1))} disabled={loading || !response || (response.page ?? 1) >= totalPages} className="inline-flex size-8 items-center justify-center rounded-md border border-slate-300 bg-white disabled:opacity-40" aria-label="下一页"><ChevronRight className="size-3.5" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ payload?: LRRTrendPoint }>; label?: string }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      <div className="font-medium text-slate-800">{label}</div>
      <div className="mt-1 text-slate-600">使用总数 {formatCount(point.issuedQuantity)}</div>
      <div className="text-slate-600">故障总数 {formatCount(point.faultCount)}</div>
      <div className={rateText(point.lrrRate)}>LRR {point.lrrRate == null ? '-' : `${point.lrrRate}%`}</div>
    </div>
  );
}

function LRREmptyOverview() {
  return (
    <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm" aria-label="物料质量概览">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="size-4 text-cyan-700" />
          <h2 className="text-sm font-semibold">物料质量概览</h2>
        </div>
        <span className="text-xs text-slate-400">待查询</span>
      </div>
      <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 lg:grid-cols-4 lg:divide-y-0">
        {['月度 PN', '使用总数', '故障总数', '综合 LRR'].map((label) => (
          <div key={label} className="px-5 py-4">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-2 text-xl font-semibold text-slate-300">--</p>
          </div>
        ))}
      </div>
      <div className="grid border-t border-slate-100 lg:grid-cols-[minmax(0,1.45fr)_minmax(240px,0.72fr)]">
        <div className="px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-700">月度趋势</h3>
          <div className="mt-4 flex h-32 items-center justify-center border-b border-l border-slate-200 bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_41px,#f1f5f9_42px)]">
            <span className="bg-white px-3 text-xs text-slate-400">待查询</span>
          </div>
        </div>
        <div className="border-t border-slate-100 px-5 py-4 lg:border-l lg:border-t-0">
          <h3 className="text-sm font-semibold text-slate-700">故障物料</h3>
          <div className="mt-4 flex h-32 items-center justify-center text-xs text-slate-400">
            待查询
          </div>
        </div>
      </div>
    </section>
  );
}

export default function LRRPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<LRRFilters>(EMPTY_FILTERS);
  const [response, setResponse] = useState<LRRListResponse | null>(null);
  const [detailItems, setDetailItems] = useState<LRRFaultDetail[] | null>(null);
  const [detailTitle, setDetailTitle] = useState('LRR 故障明细');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<ApiRequestError | null>(null);
  const [detailLoadingRow, setDetailLoadingRow] = useState<string | null>(null);
  const [usageResponse, setUsageResponse] = useState<LRRUsageDetailsResponse | null>(null);
  const [usageTitle, setUsageTitle] = useState('订单使用数量明细');
  const [usageOpen, setUsageOpen] = useState(false);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<ApiRequestError | null>(null);
  const [usageLoadingRow, setUsageLoadingRow] = useState<string | null>(null);
  const [filteredOrdersResponse, setFilteredOrdersResponse] = useState<LRRFilteredOrdersResponse | null>(null);
  const [filteredOrdersOpen, setFilteredOrdersOpen] = useState(false);
  const [filteredOrdersLoading, setFilteredOrdersLoading] = useState(false);
  const [filteredOrdersError, setFilteredOrdersError] = useState<ApiRequestError | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<ApiRequestError | null>(null);
  const [loadedQueryKey, setLoadedQueryKey] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const sequence = useRef(0);
  const detailRequest = useRef(0);
  const usageRequest = useRef(0);
  const filteredOrdersRequest = useRef(0);
  const queryController = useRef<AbortController | null>(null);

  const cancelQuery = useCallback(() => {
    sequence.current += 1;
    queryController.current?.abort();
    queryController.current = null;
    setLoading(false);
  }, []);

  useEffect(() => {
    const abortOnPageHide = () => queryController.current?.abort();
    window.addEventListener('pagehide', abortOnPageHide);
    return () => {
      window.removeEventListener('pagehide', abortOnPageHide);
      queryController.current?.abort();
    };
  }, []);

  const load = useCallback(async (targetPage: number, nextFilters: LRRFilters) => {
    const current = ++sequence.current;
    queryController.current?.abort();
    const controller = new AbortController();
    queryController.current = controller;
    setLoading(true);
    setError(null);
    try {
      const result = await lrrApi.getLRRData(targetPage, PAGE_SIZE, nextFilters, controller.signal);
      if (current === sequence.current) {
        setResponse(result);
        setPage(result.page);
        setLoadedQueryKey(filtersKey(nextFilters));
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        console.error('Failed to fetch LRR data', err);
        if (current === sequence.current) setError(normalizeApiError(err));
      }
    } finally {
      if (queryController.current === controller) queryController.current = null;
      if (current === sequence.current) setLoading(false);
    }
  }, []);

  const applyFilters = useCallback((next: LRRFilters) => {
    clearLrrApiCache();
    setFilters(next);
    setPage(1);
    setError(null);
    setLoadedQueryKey(null);
    if (!hasSearchCriteria(next)) {
      sequence.current += 1;
      queryController.current?.abort();
      queryController.current = null;
      setResponse(null);
      setSearched(false);
      setLoading(false);
      return;
    }
    setSearched(true);
    void load(1, next);
  }, [load]);

  const reset = useCallback(() => {
    clearLrrApiCache();
    sequence.current += 1;
    queryController.current?.abort();
    queryController.current = null;
    setFilters(EMPTY_FILTERS);
    setResponse(null);
    setSearched(false);
    setError(null);
    setExportError(null);
    setLoadedQueryKey(null);
    setLoading(false);
    setPage(1);
  }, []);

  const openDetails = async (next: LRRFilters, title: string) => {
    const request = ++detailRequest.current;
    setDetailTitle(title);
    setDetailItems([]);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const result = await lrrApi.getFaultDetails(next);
      if (request === detailRequest.current) {
        setDetailItems(result.items);
        setDetailTitle(result.truncated ? `${title}（前 ${result.items.length.toLocaleString('zh-CN')} 条）` : title);
      }
    } catch (err) {
      if (request === detailRequest.current) {
        setDetailItems([]);
        setDetailError(normalizeApiError(err));
      }
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  };

  const openRowDetails = (row: LRRData) => {
    if (detailLoading) return;
    setDetailLoadingRow(row.id);
    const monthBounds = plannedMonthBounds(row.month);
    const isExactMonthRange = monthBounds
      && filters.plannedDateFrom === monthBounds.from
      && filters.plannedDateTo === monthBounds.to;
    const detailFilters = {
      ...filters,
      materialNumber: row.materialNumber,
      ...(isExactMonthRange ? {} : { month: row.month }),
    };
    void openDetails(detailFilters, `${displayMaterialNumber(row.materialNumber)} ${row.month} 故障明细`).finally(() => setDetailLoadingRow(null));
  };

  const openUsageDetails = async (row: LRRData) => {
    if (usageLoading) return;
    const request = ++usageRequest.current;
    setUsageOpen(true);
    setUsageResponse(null);
    setUsageError(null);
    setUsageLoading(true);
    setUsageLoadingRow(row.id);
    const title = `${displayMaterialNumber(row.materialNumber)} ${row.month} 各订单使用数量`;
    setUsageTitle(title);
    try {
      const result = await lrrApi.getUsageDetails(filters, row.materialNumber, row.month);
      if (request === usageRequest.current) setUsageResponse(result);
    } catch (err) {
      if (request === usageRequest.current) setUsageError(normalizeApiError(err));
    } finally {
      if (request === usageRequest.current) {
        setUsageLoading(false);
        setUsageLoadingRow(null);
      }
    }
  };

  const closeUsageDetails = useCallback(() => {
    usageRequest.current += 1;
    setUsageOpen(false);
    setUsageLoading(false);
    setUsageLoadingRow(null);
    setUsageError(null);
  }, []);

  const openFilteredOrders = useCallback(async (targetPage = 1) => {
    const request = ++filteredOrdersRequest.current;
    setFilteredOrdersOpen(true);
    setFilteredOrdersLoading(true);
    setFilteredOrdersError(null);
    try {
      const result = await lrrApi.getFilteredOrders(filters, targetPage, 50);
      if (request === filteredOrdersRequest.current) setFilteredOrdersResponse(result);
    } catch (err) {
      if (request === filteredOrdersRequest.current) setFilteredOrdersError(normalizeApiError(err));
    } finally {
      if (request === filteredOrdersRequest.current) setFilteredOrdersLoading(false);
    }
  }, [filters]);

  const closeFilteredOrders = useCallback(() => {
    filteredOrdersRequest.current += 1;
    setFilteredOrdersOpen(false);
    setFilteredOrdersLoading(false);
    setFilteredOrdersError(null);
  }, []);

  const openMaterialDetails = (item: LRRMaterialRank) => {
    if (detailLoading) return;
    void openDetails({ ...filters, materialNumber: item.materialNumber }, `${displayMaterialNumber(item.materialNumber)} 故障明细`);
  };

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const reuseLoadedList = response
        && loadedQueryKey === filtersKey(filters)
        && response.items.length >= response.total;
      const [faultResult, materialItems] = await Promise.all([
        lrrApi.getFaultDetails(filters),
        reuseLoadedList ? Promise.resolve(response.items.slice(0, response.total)) : lrrApi.getAllLRRData(filters),
      ]);
      const faultRows = faultResult.items.map((item) => ({
        月份: item.month,
        物料PN: displayMaterialNumber(item.materialNumber),
        完整物料PN: item.materialNumber,
        物料描述: item.materialDescription,
        SN: item.sn,
        故障类型: item.faultType,
        故障描述: item.faultDesc,
        计入机型: item.matchedModel,
        销售订单: item.salesOrder,
        维修记录订单: item.productionOrder,
        故障现象: item.faultPhenomenon,
        维修措施: item.repairAction,
        故障工站: item.station,
        维修人员: item.repairPerson,
        维修时间: item.repairTime,
      }));
      const summaryRows = materialItems.map((item) => ({
        月份: item.month,
        物料PN: displayMaterialNumber(item.materialNumber),
        完整物料PN: item.materialNumber,
        物料描述: item.materialDescription,
        使用总数: item.issuedQuantity,
        故障总数: item.faultCount ?? '',
        故障率: item.lrrRate == null ? '' : `${item.lrrRate}%`,
      }));
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(faultRows), 'LRR故障明细');
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(summaryRows), '汇总数据');
      XLSX.writeFile(book, `LRR数据_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      console.error('LRR export failed', err);
      setExportError(normalizeApiError(err));
    } finally {
      setExporting(false);
    }
  };

  const data = response?.items ?? [];
  const totalPages = Math.max(1, Math.ceil((response?.total ?? 0) / PAGE_SIZE));
  const trend = useMemo(() => {
    if (response?.trend) return response.trend;
    const map = new Map<string, LRRTrendPoint>();
    data.forEach((row) => {
      const item = map.get(row.month) ?? { month: row.month, issuedQuantity: 0, faultCount: 0, lrrRate: 0 };
      item.issuedQuantity += row.issuedQuantity;
      if (item.faultCount !== null && row.faultCount !== null) {
        item.faultCount += row.faultCount;
        item.lrrRate = item.issuedQuantity ? Number(((item.faultCount / item.issuedQuantity) * 100).toFixed(2)) : 0;
      } else {
        item.faultCount = null;
        item.lrrRate = null;
      }
      map.set(row.month, item);
    });
    return [...map.values()].sort((left, right) => left.month.localeCompare(right.month));
  }, [data, response?.trend]);
  const hotspots = response?.hotspots ?? [];
  const maxHotspotFaults = Math.max(...hotspots.map((item) => item.faultCount), 1);
  const summary = response?.summary;
  const showDashboard = Boolean(response);

  return (
    <div className="min-h-screen bg-[#f6f8fb] text-slate-800">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95">
        <div className="mx-auto flex min-h-15 max-w-[1600px] items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-2.5">
            <button type="button" onClick={() => navigate('/')} className="inline-flex size-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" aria-label="返回首页"><ArrowLeft className="size-4" /></button>
            <div className="flex size-8 items-center justify-center rounded-md bg-cyan-600 text-white"><BellRing className="size-4" /></div>
            <div>
              <div className="flex items-center gap-1"><h1 className="text-base font-semibold">LRR 物料故障率</h1><HelpTooltip label="查看 LRR 统计说明">
                <p>月度 PN 按每月、每个物料计一行。使用总数为订单 BOM 发料数量；故障总数按生产订单和物料 PN 匹配维修记录。</p>
                <p className="mt-1">使用总数 = BWART 261 的 MENGE_A 合计 - BWART 262 的 MENGE_A 合计；BWART 601、602、Z35、Z37 不参与。LRR = 故障总数 ÷ 使用总数 × 100%。</p>
                <p className="mt-1">趋势柱表示使用总数，折线表示 LRR。故障按维修记录计划生产时间 GSTRS 归属月份，趋势汇总查询结果的全部月份。故障物料按各月故障数总和排序；点击物料可查看当前范围故障 SN。</p>
                <p className="mt-1">物料明细一行对应一个月份和 PN；故障率低于 2% 为绿，2% 至 5% 为黄，达到 5% 为红。日期范围最多 1 年。</p>
              </HelpTooltip></div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DashboardSwitcher />
            <button type="button" onClick={() => void handleExport()} disabled={exporting || !searched} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 px-3 text-sm disabled:cursor-not-allowed disabled:opacity-45" aria-label="导出故障明细">
              <Download className="size-4" /><span className="hidden sm:inline">{exporting ? '导出中' : '导出'}</span>
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-4 py-4 sm:px-6 lg:px-8">
        <section className="relative overflow-visible rounded-md border border-slate-200 bg-white shadow-sm">
          <LRRFiltersPanel filters={filters} onSearch={applyFilters} onReset={reset} />
          {error && <ErrorBanner error={error} onRetry={() => void load(page, filters)} />}
          {exportError && <ErrorBanner error={exportError} onRetry={() => void handleExport()} />}
        </section>
        {!searched && !loading && <LRREmptyOverview />}
        {loading && !response && (
          <section className="flex min-h-36 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white text-sm text-slate-500 shadow-sm">
            <LoadingSpinner size="sm" />正在计算所选范围的物料 LRR...
          </section>
        )}

        {showDashboard && (
          <>
            <section className="grid grid-cols-2 divide-x divide-y divide-slate-200 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm lg:grid-cols-4 lg:divide-y-0">
              {([
                ['月度 PN', '查询范围内的月份 × 物料 PN 行数', loading && !summary ? null : summary?.materialCount ?? 0, false],
                ['使用总数', '订单 BOM 中的物料发料数量', loading && !summary ? null : summary?.issuedQuantity ?? 0, false],
                ['故障总数', '按生产订单和物料 PN 匹配的故障记录数', loading && !summary ? null : summary?.totalFaults ?? null, false],
                ['综合 LRR', '故障总数 ÷ 使用总数', loading && !summary ? null : summary?.overallLrr ?? null, true],
              ] as const).map(([label, description, value, isRate]) => {
                const text = value == null ? (loading ? '…' : '-') : isRate ? `${value}%` : formatCount(value);
                return (
                  <div key={label} className="px-4 py-3.5">
                    <div className="flex items-center gap-1 text-xs text-slate-500"><span>{label}</span><HelpTooltip label={`查看${label}说明`}>{description}</HelpTooltip></div>
                    <div className={`mt-1 truncate font-mono text-xl font-semibold ${isRate ? rateText(typeof value === 'number' ? value : null) : 'text-slate-900'}`}>{text}</div>
                  </div>
                );
              })}
            </section>

            <section className="grid gap-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.72fr)]">
              <div className="overflow-hidden rounded-md border border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="size-4 text-cyan-700" />
                    <h2 className="text-sm font-semibold">月度趋势</h2>
                  </div>
                  <div className="flex gap-4 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1.5"><i className="size-2 bg-teal-500" />使用总数</span>
                    <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-3 bg-slate-600" />LRR</span>
                  </div>
                </div>
                <div className="h-64">
                  {trend.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={trend} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} />
                        <YAxis yAxisId="count" allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} />
                        <YAxis yAxisId="rate" orientation="right" unit="%" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} />
                        <Tooltip content={<TrendTooltip />} />
                        <Bar yAxisId="count" dataKey="issuedQuantity" name="issuedQuantity" fill="#14b8a6" maxBarSize={34} />
                        <Line yAxisId="rate" dataKey="lrrRate" name="lrrRate" type="monotone" stroke="#475569" strokeWidth={2} dot={{ r: 3, fill: '#475569', strokeWidth: 0 }} connectNulls={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : loading ? (
                    <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-400"><LoadingSpinner size="sm" />正在加载月度数据...</div>
                  ) : (
                    <div className="flex h-full items-center justify-center border border-dashed border-slate-200 text-sm text-slate-400">暂无月度数据</div>
                  )}
                </div>
              </div>

              <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-5">
                  <h2 className="text-sm font-semibold">故障物料</h2>
                  <span className="font-mono text-xs text-slate-400">{loading ? '' : hotspots.length}</span>
                </div>
                {loading && !hotspots.length ? (
                  <div className="flex h-64 items-center justify-center gap-2 text-sm text-slate-400"><LoadingSpinner size="sm" />正在汇总故障物料...</div>
                ) : hotspots.length ? (
                  <div>
                    {hotspots.map((item) => (
                      <button
                        key={item.materialNumber}
                        type="button"
                        onClick={() => openMaterialDetails(item)}
                        className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-2.5 text-left last:border-b-0 hover:bg-slate-50 sm:px-5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2">
                            <span className="truncate font-mono text-xs font-semibold text-slate-800" title={item.materialNumber}>{displayMaterialNumber(item.materialNumber)}</span>
                            <span className="min-w-0 flex-1 truncate text-[11px] text-slate-400" title={item.materialDescription}>{item.materialDescription || '-'}</span>
                          </div>
                          <span className="mt-1.5 block h-1.5 overflow-hidden rounded-sm bg-slate-100">
                            <span className={`block h-full ${(item.lrrRate ?? 0) >= 5 ? 'bg-red-500' : (item.lrrRate ?? 0) >= 2 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${(item.faultCount / maxHotspotFaults) * 100}%` }} />
                          </span>
                        </div>
                        <div className="text-right">
                          <div className={`font-mono text-sm font-semibold ${rateText(item.lrrRate)}`}>{item.lrrRate == null ? '-' : `${item.lrrRate}%`}</div>
                          <div className="font-mono text-[11px] text-slate-400">{formatCount(item.faultCount)}/{formatCount(item.issuedQuantity)}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex h-64 items-center justify-center text-sm text-slate-400">当前范围没有故障</div>
                )}
              </div>
            </section>

            <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-5">
                <h2 className="text-sm font-semibold">物料 PN 明细</h2>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => { void openFilteredOrders(); }} disabled={loading || filteredOrdersLoading} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-wait disabled:opacity-50"><ListFilter className="size-3.5" />过滤订单</button>
                  <span className="text-xs text-slate-500">{loading ? '正在更新' : `共 ${formatCount(response?.total ?? 0)} 条`}</span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-sm">
                  <thead className="text-xs font-semibold text-slate-600">
                    <tr>{['月份', '物料 PN', '物料描述', '使用总数', '故障总数', '故障率'].map((name) => <th key={name} className="border-b border-r border-slate-200 bg-slate-50 px-4 py-3">{name}</th>)}</tr>
                  </thead>
                  <tbody className="text-xs">
                    {loading ? <tr><td colSpan={6} className="px-4 py-16 text-center text-slate-500">正在加载数据...</td></tr> : data.length ? data.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => openRowDetails(row)}
                        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openRowDetails(row); } }}
                        tabIndex={0}
                        role="button"
                        aria-label={`查看 ${displayMaterialNumber(row.materialNumber)} ${row.month} 故障明细`}
                        className="cursor-pointer transition-colors hover:bg-red-50/50 focus:bg-red-50/50 focus:outline-none"
                      >
                        <td className="border-b border-r border-slate-200 px-4 py-3 font-mono">{row.month}</td>
                        <td className="border-b border-r border-slate-100 px-4 py-3 font-mono font-medium"><span title={row.materialNumber}>{displayMaterialNumber(row.materialNumber)}</span></td>
                        <td className="border-b border-r border-slate-100 px-4 py-3">{row.materialDescription || '-'}</td>
                        <td className="border-b border-r border-slate-100 px-4 py-3 text-right font-mono">
                          <button
                            type="button"
                            disabled={usageLoading}
                            onClick={(event) => { event.stopPropagation(); void openUsageDetails(row); }}
                            className="inline-flex items-center justify-end gap-1 font-semibold text-cyan-800 underline decoration-dotted underline-offset-2 hover:text-cyan-950 disabled:cursor-wait disabled:opacity-60"
                            aria-label={`查看 ${displayMaterialNumber(row.materialNumber)} ${row.month} 各订单使用数量`}
                            title="点击查看每个订单对应的使用数量"
                          >
                            {usageLoadingRow === row.id ? <LoadingSpinner size="sm" className="border-cyan-700" /> : row.issuedQuantity.toLocaleString('zh-CN')}
                          </button>
                        </td>
                        <td className="border-b border-r border-slate-100 px-4 py-3 text-right font-mono">
                          {row.faultCount == null ? (
                            <button type="button" disabled={detailLoading} onClick={(event) => { event.stopPropagation(); openRowDetails(row); }} className="font-semibold text-slate-500 underline decoration-dotted disabled:cursor-wait disabled:opacity-60">
                              {detailLoadingRow === row.id ? <LoadingSpinner size="sm" className="border-slate-500" /> : '查看'}
                            </button>
                          ) : row.faultCount ? (
                            <button type="button" disabled={detailLoading} onClick={(event) => { event.stopPropagation(); openRowDetails(row); }} className="inline-flex items-center justify-end gap-1 font-semibold text-red-700 underline decoration-dotted disabled:cursor-wait disabled:opacity-60">
                              {detailLoadingRow === row.id ? <LoadingSpinner size="sm" className="border-red-700" /> : row.faultCount.toLocaleString('zh-CN')}
                              <span className="sr-only">{detailLoadingRow === row.id ? '正在加载故障明细' : `查看 ${row.faultCount} 条故障明细`}</span>
                            </button>
                          ) : <span className="text-slate-400">0</span>}
                        </td>
                        <td className="border-b border-slate-100 p-1.5 text-center"><span className={`inline-flex min-w-24 justify-center rounded-sm px-2 py-2 font-mono font-semibold ${rateClass(row.lrrRate)}`}>{row.lrrRate == null ? '-' : `${row.lrrRate}%`}</span></td>
                      </tr>
                    )) : <tr><td colSpan={6} className="px-4 py-16 text-center text-slate-500">暂无符合条件的数据</td></tr>}
                  </tbody>
                </table>
              </div>
              {response && (
                <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                  <span>第 {page} / {totalPages} 页，共 {response.total.toLocaleString('zh-CN')} 条</span>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => { const next = Math.max(1, page - 1); setPage(next); void load(next, filters); }} disabled={page <= 1} className="inline-flex size-8 items-center justify-center rounded-md border border-slate-300 bg-white disabled:opacity-40" aria-label="上一页"><ChevronLeft className="size-3.5" /></button>
                    <button type="button" onClick={() => { const next = Math.min(totalPages, page + 1); setPage(next); void load(next, filters); }} disabled={page >= totalPages} className="inline-flex size-8 items-center justify-center rounded-md border border-slate-300 bg-white disabled:opacity-40" aria-label="下一页"><ChevronRight className="size-3.5" /></button>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </main>
      {detailItems && (
        <DetailModal
          title={detailTitle}
          items={detailItems}
          loading={detailLoading}
          error={detailError}
          onClose={() => { detailRequest.current += 1; setDetailLoading(false); setDetailLoadingRow(null); setDetailError(null); setDetailItems(null); }}
        />
      )}
      {usageOpen && (
        <UsageDetailsModal
          title={usageTitle}
          response={usageResponse}
          loading={usageLoading}
          error={usageError}
          onClose={closeUsageDetails}
        />
      )}
      {filteredOrdersOpen && (
        <FilteredOrdersModal
          response={filteredOrdersResponse}
          loading={filteredOrdersLoading}
          error={filteredOrdersError}
          onClose={closeFilteredOrders}
          onPageChange={(nextPage) => { void openFilteredOrders(nextPage); }}
        />
      )}
      {loading && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4" role="status" aria-live="polite">
          <div className="pointer-events-auto inline-flex items-center gap-2 rounded-md border border-cyan-200 bg-white px-4 py-2.5 text-sm font-medium text-cyan-800 shadow-lg shadow-slate-900/10">
            <LoadingSpinner size="sm" className="border-cyan-600 motion-reduce:animate-none" />
            <span>数据加载中</span>
            <button type="button" onClick={cancelQuery} className="ml-1 inline-flex size-7 items-center justify-center rounded-sm text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="取消查询" aria-label="取消查询">
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
