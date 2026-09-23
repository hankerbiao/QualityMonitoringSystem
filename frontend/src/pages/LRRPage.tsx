import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BarChart3, BellRing, ChevronLeft, ChevronRight, Download, RotateCcw, X } from 'lucide-react';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import * as XLSX from 'xlsx';
import { useNavigate } from 'react-router-dom';
import { lrrApi } from '../api/lrrApi';
import LRRFiltersPanel from '../components/lrr/LRRFilters';
import { DashboardSwitcher } from '../components/shared/DashboardSwitcher';
import { LoadingSpinner } from '../components/ui';
import { ApiRequestError } from '../api/authApi';
import type { LRRData, LRRFaultDetail, LRRFilters, LRRListResponse, LRRMaterialRank, LRRTrendPoint } from '../types';
import { displayMaterialNumber } from '../utils/lrr';

const PAGE_SIZE = 50;
const EMPTY_FILTERS: LRRFilters = { sortBy: 'month', sortDir: 'asc' };
const FILTER_KEYS: Array<keyof LRRFilters> = [
  'plannedDateFrom',
  'plannedDateTo',
  'ngDateFrom',
  'ngDateTo',
  'materialNumber',
  'productModel',
  'base',
  'customerId',
  'month',
];
const hasSearchCriteria = (candidate: LRRFilters) => FILTER_KEYS.some((key) => Boolean(candidate[key]));
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

function DetailModal({ title, items, loading, error, onClose }: { title: string; items: LRRFaultDetail[]; loading: boolean; error: ApiRequestError | null; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-busy={loading} className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button ref={closeRef} type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-200" aria-label="关闭"><X className="size-4" /></button>
        </div>
        {loading ? <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-sm text-slate-500"><LoadingSpinner size="md" />正在加载故障明细...</div> : error ? (
          <div role="alert" className="flex min-h-48 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-red-700">
            <p>{errorMessage(error)}</p>
            {error.requestId && <p className="text-xs text-slate-400">请求编号：{error.requestId}</p>}
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="sticky top-0 bg-slate-100 text-slate-600">
                <tr>{['月份', '物料 PN', '物料描述', 'SN', '故障类型', '故障描述', 'NG 时间'].map((name) => <th key={name} className="px-3 py-2 font-semibold">{name}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item, index) => (
                  <tr key={`${item.materialNumber}-${item.sn}-${index}`}>
                    <td className="px-3 py-2">{item.month || '-'}</td>
                    <td className="px-3 py-2 font-mono">{displayMaterialNumber(item.materialNumber) || '-'}</td>
                    <td className="px-3 py-2">{item.materialDescription || '-'}</td>
                    <td className="px-3 py-2 font-mono">{item.sn || '-'}</td>
                    <td className="px-3 py-2">{item.faultType || '-'}</td>
                    <td className="max-w-[240px] truncate px-3 py-2">{item.faultDesc || '-'}</td>
                    <td className="px-3 py-2">{item.ngTime || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!items.length && <p className="px-4 py-12 text-center text-sm text-slate-400">暂无故障明细</p>}
          </div>
        )}
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

function QueryGuide() {
  const metrics = [
    ['月度 PN', '每个月、每个物料记一行'],
    ['使用总数', '订单 BOM 发料数量'],
    ['故障总数', '按生产订单和物料 PN 匹配维修'],
    ['综合 LRR', '故障总数 / 使用总数'],
  ];
  const boards = [
    ['月度趋势', '柱子是使用总数，折线是 LRR。按查询结果的全部月份汇总，不按表格当前页截断。'],
    ['故障物料', '同一物料各月故障数加总后，从高到低排列。点一行查看当前范围内的故障 SN。'],
    ['物料明细', '一行对应一个月份的一个 PN。故障率低于 2% 为绿，2% 至 5% 为黄，达到 5% 为红。'],
  ];
  return (
    <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
      <div className="grid grid-cols-2 divide-x divide-y divide-slate-200 lg:grid-cols-4 lg:divide-y-0">
        {metrics.map(([label, detail]) => (
          <div key={label} className="px-4 py-3.5">
            <div className="text-xs text-slate-500">{label}</div>
            <p className="mt-1 text-sm leading-5 text-slate-700">{detail}</p>
          </div>
        ))}
      </div>
      <div className="grid divide-y divide-slate-200 border-t border-slate-200 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        {boards.map(([title, detail]) => (
          <div key={title} className="px-4 py-4 sm:px-5">
            <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
            <p className="mt-1.5 text-xs leading-5 text-slate-500">{detail}</p>
          </div>
        ))}
      </div>
      <p className="border-t border-slate-200 px-4 py-3 text-xs leading-5 text-slate-500 sm:px-5">计划日期范围不超过 93 天。选定条件后点查询，或使用本月、近2个月、近3个月。数量要等生产数据返回后才显示。</p>
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
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<ApiRequestError | null>(null);
  const [page, setPage] = useState(1);
  const sequence = useRef(0);
  const detailRequest = useRef(0);

  const load = useCallback(async (targetPage: number, nextFilters: LRRFilters) => {
    const current = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const result = await lrrApi.getLRRData(targetPage, PAGE_SIZE, nextFilters);
      if (current === sequence.current) {
        setResponse(result);
        setPage(result.page);
      }
    } catch (err) {
      console.error('Failed to fetch LRR data', err);
      if (current === sequence.current) setError(normalizeApiError(err));
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, []);

  const applyFilters = useCallback((next: LRRFilters) => {
    setFilters(next);
    setPage(1);
    setError(null);
    if (!hasSearchCriteria(next)) {
      sequence.current += 1;
      setResponse(null);
      setSearched(false);
      setLoading(false);
      return;
    }
    setSearched(true);
    void load(1, next);
  }, [load]);

  const reset = useCallback(() => {
    sequence.current += 1;
    setFilters(EMPTY_FILTERS);
    setResponse(null);
    setSearched(false);
    setError(null);
    setExportError(null);
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
    void openDetails({ ...filters, materialNumber: row.materialNumber, month: row.month }, `${displayMaterialNumber(row.materialNumber)} ${row.month} 故障明细`).finally(() => setDetailLoadingRow(null));
  };

  const openMaterialDetails = (item: LRRMaterialRank) => {
    if (detailLoading) return;
    void openDetails({ ...filters, materialNumber: item.materialNumber }, `${displayMaterialNumber(item.materialNumber)} 故障明细`);
  };

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const result = await lrrApi.getFaultDetails(filters);
      const rows = result.items.map((item) => ({
        月份: item.month,
        物料PN: displayMaterialNumber(item.materialNumber),
        完整物料PN: item.materialNumber,
        物料描述: item.materialDescription,
        SN: item.sn,
        故障类型: item.faultType,
        故障描述: item.faultDesc,
        NG时间: item.ngTime,
      }));
      const sheet = XLSX.utils.json_to_sheet(rows);
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, 'LRR故障明细');
      XLSX.writeFile(book, `LRR故障明细_${new Date().toISOString().slice(0, 10)}.xlsx`);
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
              <h1 className="text-base font-semibold">LRR 物料故障率</h1>
              <p className="hidden text-xs text-slate-500 sm:block">物料 PN 月度故障率</p>
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

        {loading && !response && (
          <section className="flex min-h-36 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white text-sm text-slate-500 shadow-sm">
            <LoadingSpinner size="sm" />正在计算所选范围的物料 LRR...
          </section>
        )}

        {!loading && !response && <QueryGuide />}

        {showDashboard && (
          <>
            <section className="grid grid-cols-2 divide-x divide-y divide-slate-200 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm lg:grid-cols-4 lg:divide-y-0">
              {([
                ['月度 PN', loading && !summary ? null : summary?.materialCount ?? 0, false],
                ['使用总数', loading && !summary ? null : summary?.issuedQuantity ?? 0, false],
                ['故障总数', loading && !summary ? null : summary?.totalFaults ?? null, false],
                ['综合 LRR', loading && !summary ? null : summary?.overallLrr ?? null, true],
              ] as const).map(([label, value, isRate]) => {
                const text = value == null ? (loading ? '…' : '-') : isRate ? `${value}%` : formatCount(value);
                return (
                  <div key={label} className="px-4 py-3.5">
                    <div className="text-xs text-slate-500">{label}</div>
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
                <span className="text-xs text-slate-500">{loading ? '正在更新' : `共 ${formatCount(response?.total ?? 0)} 条`}</span>
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
                        <td className="border-b border-r border-slate-100 px-4 py-3 text-right font-mono">{row.issuedQuantity.toLocaleString('zh-CN')}</td>
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
    </div>
  );
}
