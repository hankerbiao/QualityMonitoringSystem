import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Database,
  Download,
  Factory,
  Package,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Modal, LoadingPage } from '../components/ui';
import { EMPTY_FILTERS, salesOrdersApi } from '../api/salesOrdersApi';
import { SAP_FIELD_LABELS, formatSapFieldValue } from '../constants/salesOrderFields';
import { useSalesOrdersQuery } from '../hooks/useSalesOrdersQuery';
import type {
  SalesOrderDocument,
  SalesOrderFilterParams,
  SalesOrderSyncResult,
} from '../types/salesOrders';

const PAGE_SIZE = 20;

/** 基地分布环形图配色（循环取色） */
const BASE_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#f97316',
  '#14b8a6',
  '#eab308',
  '#ec4899',
  '#6366f1',
  '#84cc16',
];

/** 机型分布环形图展示的 Top N 机型，其余聚合为「其他」
 *  取 10 使图例 11 项恰好 2 列 6 行，与基地分布（12 项 / 6 行）等高对齐 */
const MODEL_TOP_N = 10;

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function isEmptyFilters(f: SalesOrderFilterParams): boolean {
  return f.cpXh.length === 0 && f.lgort.length === 0 && !f.dateFrom && !f.dateTo && !f.keyword.trim();
}

/** 可多选的下拉过滤控件（机型 / 基地共用） */
interface MultiSelectOption {
  value: string;
  count?: number;
}

function MultiSelect({
  label,
  placeholder,
  options,
  selected,
  onChange,
}: {
  label: string;
  placeholder: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter((o) => o.value.toLocaleLowerCase().includes(normalizedQuery))
    : options;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => {
            if (!o) setQuery('');
            return !o;
          });
        }}
        className={`flex h-9 min-w-40 items-center justify-between gap-2 rounded-md border bg-white px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
          selected.length > 0 ? 'border-blue-400 text-slate-800' : 'border-slate-200 text-slate-500 hover:border-slate-300'
        }`}
      >
        <span className="truncate">
          {selected.length > 0 ? `${label} (${selected.length})` : placeholder}
        </span>
        <ChevronDown className={`size-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg shadow-slate-900/10">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
            <span className="text-xs font-medium text-slate-500">{label}</span>
            <div className="flex items-center gap-3 text-xs">
              <button
                type="button"
                onClick={() => onChange(filteredOptions.map((o) => o.value))}
                className="font-medium text-blue-600 hover:text-blue-700"
              >
                全选
              </button>
              <button
                type="button"
                onClick={() => onChange([])}
                className="font-medium text-slate-500 hover:text-slate-700"
              >
                清空
              </button>
            </div>
          </div>
          <div className="border-b border-slate-100 px-3 py-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`搜索${label}…`}
                className="h-8 w-full rounded-md border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/15"
              />
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {options.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-slate-400">暂无可选项目</p>
            ) : filteredOptions.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-slate-400">无匹配“{query.trim()}”的项目</p>
            ) : (
              filteredOptions.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-blue-50/60"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(option.value)}
                    onChange={() => toggle(option.value)}
                    className="size-3.5 rounded border-slate-300 accent-blue-600"
                  />
                  <span className="truncate font-mono text-xs">{option.value}</span>
                  {option.count != null && (
                    <span className="ml-auto shrink-0 text-xs text-slate-400">{formatNumber(option.count)}</span>
                  )}
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 统计卡片 */
function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  accent,
}: {
  icon: typeof Database;
  label: string;
  value: string;
  detail: string;
  accent: string;
}) {
  return (
    <div className="min-w-0 px-5 py-4 lg:px-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${accent}`}>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-1 truncate text-xs text-slate-400">{detail}</p>
    </div>
  );
}

/** 详情弹窗：展示订单 data 全字段与同步元信息 */
function OrderDetailModal({
  order,
  onClose,
}: {
  order: SalesOrderDocument;
  onClose: () => void;
}) {
  const dataEntries = useMemo(
    () => Object.entries(order.data).filter(([, v]) => v !== null && v !== undefined && v !== ''),
    [order.data],
  );

  return (
    <Modal title={`订单详情 · ${order.aufnr}`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-slate-100 bg-slate-50/60 px-5 py-4 sm:grid-cols-3">
        {[
          { label: '订单号', value: order.aufnr },
          { label: '计划开始日期', value: order.gstrs_date || '—' },
          { label: '来源', value: order.sources.length ? order.sources.join(' / ') : '—' },
          { label: '首次同步', value: formatDateTime(order.first_seen_at) },
          { label: '最后同步', value: formatDateTime(order.last_synced_at) },
          { label: '同步次数', value: `${order.sync_count} 次` },
        ].map((item) => (
          <div key={item.label}>
            <p className="text-xs text-slate-400">{item.label}</p>
            <p className="mt-0.5 truncate text-sm font-medium text-slate-700" title={item.value}>{item.value}</p>
          </div>
        ))}
      </div>

      <div className="px-5 py-4">
        <h4 className="mb-3 text-sm font-semibold text-slate-800">SAP 数据字段（{dataEntries.length}）</h4>
        {dataEntries.length === 0 ? (
          <p className="text-sm text-slate-400">该订单暂无 SAP 数据字段。</p>
        ) : (
          <div className="overflow-hidden rounded-md border border-slate-200">
            <table className="w-full text-left text-sm">
              <tbody className="divide-y divide-slate-100">
                {dataEntries.map(([key, value]) => (
                  <tr key={key} className="align-top">
                    <th className="w-48 whitespace-nowrap bg-slate-50 px-3 py-2 text-xs font-medium text-slate-500">
                      <span>{SAP_FIELD_LABELS[key] ?? key}</span>
                      {SAP_FIELD_LABELS[key] && (
                        <span className="ml-1.5 font-mono text-[10px] font-normal text-slate-400">{key}</span>
                      )}
                    </th>
                    <td className="break-all px-3 py-2 font-mono text-xs text-slate-700">
                      {formatSapFieldValue(key, value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <details className="border-t border-slate-100 px-5 py-3">
        <summary className="cursor-pointer text-sm font-medium text-slate-600 hover:text-slate-800">
          各来源原始记录（source_records）
        </summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-slate-50 p-3 text-xs leading-5 text-slate-600">
          {JSON.stringify(order.source_records, null, 2)}
        </pre>
      </details>
    </Modal>
  );
}

/** 立即同步弹窗：选择月份，从 SG / KK 双来源拉取销售订单 */
function SyncSalesOrdersModal({
  onClose,
  onSynced,
}: {
  onClose: () => void;
  onSynced: () => void;
}) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SalesOrderSyncResult | null>(null);
  const [error, setError] = useState('');

  const handleSync = async () => {
    if (!month) return;
    setSyncing(true);
    setError('');
    setResult(null);
    try {
      const [year, monthIndex] = month.split('-').map(Number);
      const endDay = new Date(year, monthIndex, 0).getDate();
      const endDate = `${month}-${String(endDay).padStart(2, '0')}`;
      const res = await salesOrdersApi.sync(`${month}-01`, endDate);
      setResult(res);
      onSynced();
    } catch (err) {
      setError(err instanceof Error ? err.message : '同步失败，请稍后重试');
    } finally {
      setSyncing(false);
    }
  };

  const sourceEntries = result ? Object.entries(result.sources) : [];

  return (
    <Modal
      title="同步销售订单"
      onClose={onClose}
      maxWidth="max-w-lg"
      footer={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={syncing}
            className="h-9 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40"
          >
            关闭
          </button>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing || !month}
            className="flex h-9 items-center gap-1.5 rounded-md bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncing ? (
              <>
                <RefreshCw className="size-4 animate-spin" />
                同步中…
              </>
            ) : (
              <>
                <Download className="size-4" />
                {result ? '再次同步' : '立即同步'}
              </>
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sync-month" className="text-xs font-medium text-slate-500">
            同步月份（按 SAP 变更日期范围拉取）
          </label>
          <input
            id="sync-month"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            disabled={syncing}
            className="h-9 w-44 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15 disabled:opacity-50"
          />
        </div>

        <ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-slate-400">
          <li>销售订单数据每天 08:30、12:30、18:30、22:30 自动同步，本操作仅在需要立即拉取时使用。</li>
          <li>同步从 SG、KK 两个 SAP 来源拉取该月份的销售订单，可能需要 1~2 分钟。</li>
          <li>SAP 按变更日期返回，GSTRS 计划开始日期可能跨月混入，与看板时间筛选互不影响。</li>
          <li>已存在订单将合并更新（同步次数 +1），不会重复新增。</li>
        </ul>

        {syncing && (
          <div className="flex items-center gap-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs text-blue-700">
            <RefreshCw className="size-3.5 animate-spin" />
            正在请求 SG / KK 来源，请稍候…
          </div>
        )}

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">{error}</div>
        )}

        {result && (
          <div className="space-y-3">
            <div
              className={`flex items-center gap-2 rounded-md border px-3 py-2.5 text-xs font-medium ${
                result.success
                  ? result.partial_success
                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-rose-200 bg-rose-50 text-rose-700'
              }`}
            >
              <Database className="size-3.5 shrink-0" />
              {result.partial_success
                ? '同步完成，但部分来源失败'
                : result.success
                  ? '同步完成'
                  : '同步失败'}
              <span className="ml-auto font-mono text-[11px] font-normal text-slate-500">
                {result.date_range.start_date} ~ {result.date_range.end_date}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: '抓取', value: result.total_fetched },
                { label: '去重', value: result.total_unique },
                { label: '跳过', value: result.total_skipped },
                { label: '新增 / 更新', value: `${result.inserted} / ${result.updated}` },
              ].map((item) => (
                <div key={item.label} className="rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2 text-center">
                  <p className="font-mono text-base font-semibold text-slate-800">{item.value}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">{item.label}</p>
                </div>
              ))}
            </div>

            <div className="overflow-hidden rounded-md border border-slate-200">
              {sourceEntries.map(([source, item]) => (
                <div
                  key={source}
                  className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-xs last:border-b-0"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-100 font-mono text-[10px] font-bold text-slate-600">
                      {source}
                    </span>
                    <span className={item.success ? 'text-emerald-600' : 'text-rose-600'}>
                      {item.success ? '成功' : '失败'}
                    </span>
                    {item.error && <span className="truncate text-slate-400" title={item.error}>{item.error}</span>}
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-slate-400">
                    抓取 {item.fetched_count} · 去重 {item.unique_count} · 跳过 {item.skipped_count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function SalesOrdersPage() {
  const navigate = useNavigate();

  const [filters, setFilters] = useState<SalesOrderFilterParams>(EMPTY_FILTERS);
  const [draft, setDraft] = useState<SalesOrderFilterParams>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState<SalesOrderDocument | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);

  const { data: queryData, loading, refreshing, error, refresh } = useSalesOrdersQuery(filters, page, PAGE_SIZE);

  const applyFilters = useCallback((next: SalesOrderFilterParams, resetPage = true) => {
    setFilters(next);
    if (resetPage) setPage(1);
  }, []);

  const handleSearch = () => {
    applyFilters(draft);
  };

  const handleReset = () => {
    setDraft(EMPTY_FILTERS);
    applyFilters(EMPTY_FILTERS);
  };

  const handleRefresh = refresh;

  const toggleDimension = (dimension: 'cpXh' | 'lgort', value: string) => {
    const current = filters[dimension];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    applyFilters({ ...filters, [dimension]: next });
  };

  const allStats = queryData?.stats ?? null;
  const listData = queryData;
  const stats = queryData?.stats ?? null;
  const modelOptions: MultiSelectOption[] = useMemo(
    () => (queryData?.filterOptions.models ?? []).map((value) => ({ value })),
    [queryData],
  );
  const baseOptions: MultiSelectOption[] = useMemo(
    () => (queryData?.filterOptions.bases ?? []).map((value) => ({ value })),
    [queryData],
  );

  const totalPages = listData ? Math.max(1, Math.ceil(listData.total / PAGE_SIZE)) : 1;
  const filtered = !isEmptyFilters(filters);
  const effectiveStats = stats;

  const chartData = useMemo(
    () => (effectiveStats?.by_month ?? []).map((item) => ({ month: item.key, count: item.count })),
    [effectiveStats],
  );
  const modelData = useMemo(() => {
    const list = effectiveStats?.by_model ?? [];
    const top = list.slice(0, MODEL_TOP_N).map((item) => ({ key: item.key, count: item.count }));
    const restCount = list.slice(MODEL_TOP_N).reduce((sum, item) => sum + item.count, 0);
    if (restCount > 0) top.push({ key: '其他', count: restCount });
    return top;
  }, [effectiveStats]);
  const baseData = useMemo(
    () => (effectiveStats?.by_base ?? []).map((item) => ({ key: item.key, count: item.count })),
    [effectiveStats],
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => navigate('/')}
              className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
              title="返回首页"
              aria-label="返回首页"
            >
              <ArrowLeft className="size-4" />
            </button>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white">
              <ClipboardList className="size-5" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-slate-900">销售订单看板</h1>
              <p className="truncate text-xs text-slate-400">全量销售订单查询、筛选与多维统计（SAP 双来源同步）</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {filtered && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                已筛选
                <button type="button" onClick={handleReset} className="hover:text-blue-900" aria-label="清除筛选">
                  <X className="size-3" />
                </button>
              </span>
            )}
            <button
              type="button"
              onClick={() => setSyncOpen(true)}
              className="flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
              title="按月份从 SAP 同步销售订单"
            >
              <Download className="size-4" />
              立即同步
            </button>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800 disabled:opacity-50"
              title="刷新数据"
              aria-label="刷新数据"
            >
              <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-4 px-4 py-5 sm:px-6 lg:px-8">
        {/* 统计卡 */}
        {allStats && (
          <section className="grid overflow-hidden rounded-md border border-slate-200 bg-white sm:grid-cols-2 lg:grid-cols-4 sm:divide-x sm:divide-y-0 divide-y divide-slate-100">
            <StatCard
              icon={Database}
              label="机器总量"
              value={formatNumber(Math.round(effectiveStats?.total_quantity ?? 0))}
              detail={`按 GAMNG 求和 · ${formatNumber(effectiveStats?.total ?? 0)} 个订单`}
              accent="bg-blue-50 text-blue-600"
            />
            <StatCard
              icon={Package}
              label="涉及机型"
              value={formatNumber(effectiveStats?.by_model.length ?? 0)}
              detail="当前结果机型数"
              accent="bg-cyan-50 text-cyan-700"
            />
            <StatCard
              icon={Factory}
              label="涉及基地"
              value={formatNumber(effectiveStats?.by_base.length ?? 0)}
              detail="当前结果基地数"
              accent="bg-amber-50 text-amber-700"
            />
            <StatCard
              icon={CalendarDays}
              label="覆盖月份"
              value={formatNumber(effectiveStats?.by_month.length ?? 0)}
              detail="按 GSTRS 统计"
              accent="bg-emerald-50 text-emerald-700"
            />
          </section>
        )}

        {/* 过滤区 */}
        <section className="rounded-md border border-slate-200 bg-white p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:flex-wrap xl:flex-1 xl:justify-between xl:gap-x-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-500">机型 (MAKTX_TH)</span>
                <MultiSelect
                  label="机型"
                  placeholder="选择机型"
                  options={modelOptions}
                  selected={draft.cpXh}
                  onChange={(values) => setDraft((d) => ({ ...d, cpXh: values }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-500">基地 (LGORT)</span>
                <MultiSelect
                  label="基地"
                  placeholder="选择基地"
                  options={baseOptions}
                  selected={draft.lgort}
                  onChange={(values) => setDraft((d) => ({ ...d, lgort: values }))}
                />
              </div>
              <div className="flex flex-col gap-1.5 xl:flex-1">
                <span className="text-xs font-medium text-slate-500">计划开始日期范围</span>
                <div className="flex items-center gap-2 xl:w-full">
                  <input
                    type="date"
                    value={draft.dateFrom}
                    max={draft.dateTo || undefined}
                    onChange={(e) => setDraft((d) => ({ ...d, dateFrom: e.target.value }))}
                    className="h-9 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
                  />
                  <span className="shrink-0 text-slate-400">至</span>
                  <input
                    type="date"
                    value={draft.dateTo}
                    min={draft.dateFrom || undefined}
                    onChange={(e) => setDraft((d) => ({ ...d, dateTo: e.target.value }))}
                    className="h-9 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5 xl:min-w-56 xl:flex-1 xl:max-w-80">
                <span className="text-xs font-medium text-slate-500">订单号 (AUFNR)</span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={draft.keyword}
                    onChange={(e) => setDraft((d) => ({ ...d, keyword: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder="输入订单号模糊搜索"
                    className="h-9 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
                  />
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={handleReset}
                disabled={isEmptyFilters(draft)}
                className="h-9 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                重置
              </button>
              <button
                type="button"
                onClick={handleSearch}
                className="flex h-9 items-center gap-1.5 rounded-md bg-slate-900 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-700"
              >
                <Search className="size-4" />
                查询
              </button>
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
            {error}，当前展示上一次成功获取的数据。
          </div>
        )}

        {/* 空态：全量无数据 */}
        {allStats && allStats.total === 0 && !loading && (
          <section className="flex min-h-[360px] flex-col items-center justify-center rounded-md border border-slate-200 bg-white px-6 text-center">
            <Database className="mb-3 size-9 text-slate-300" />
            <p className="text-sm font-semibold text-slate-700">暂无销售订单数据</p>
            <p className="mt-2 max-w-md text-xs leading-5 text-slate-400">
              看板数据来自 SAP 双来源同步集合（sales_orders_sap）。该集合当前为空，请先调用
              <code className="mx-1 rounded bg-slate-100 px-1 py-0.5 font-mono">POST /api/sales-orders/sync</code>
              按变更日期范围拉取 SG / KK 来源数据，或使用回灌脚本导入后刷新。
            </p>
            <button
              type="button"
              onClick={handleRefresh}
              className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              重新加载
            </button>
          </section>
        )}

        {/* 主体：列表 + 统计面板 */}
        {!(allStats && allStats.total === 0) && (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.75fr)]">
            {/* 列表 */}
            <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-800">订单列表</h2>
                  <p className="mt-1 text-xs text-slate-400">
                    {listData ? `共 ${formatNumber(listData.total)} 条 · 按订单号升序` : '加载中…'}
                  </p>
                </div>
                {filtered && (
                  <span className="text-xs text-slate-400">当前为筛选后结果</span>
                )}
              </div>

              {loading && !listData ? (
                <LoadingPage />
              ) : listData && listData.items.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[880px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-400">
                      <tr>
                        <th className="px-5 py-2.5 font-medium">订单号</th>
                        <th className="px-5 py-2.5 font-medium">机型</th>
                        <th className="px-5 py-2.5 font-medium">基地</th>
                        <th className="px-5 py-2.5 font-medium">计划开始日期</th>
                        <th className="px-5 py-2.5 font-medium">来源</th>
                        <th className="px-5 py-2.5 font-medium">最后同步</th>
                        <th className="px-5 py-2.5 text-right font-medium">同步次数</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {listData.items.map((order) => (
                        <tr
                          key={order.id}
                          onClick={() => setSelectedOrder(order)}
                          className="cursor-pointer text-slate-600 transition-colors hover:bg-blue-50/40"
                        >
                          <td className="px-5 py-3 font-mono text-xs font-semibold text-blue-700">{order.aufnr}</td>
                          <td className="px-5 py-3 font-mono text-xs">{String(order.data.MAKTX_TH ?? '—')}</td>
                          <td className="px-5 py-3 font-mono text-xs">{String(order.data.LGORT ?? '—')}</td>
                          <td className="px-5 py-3 font-mono text-xs">{order.gstrs_date || '—'}</td>
                          <td className="px-5 py-3">
                            <div className="flex gap-1">
                              {order.sources.length === 0 ? (
                                <span className="text-xs text-slate-300">—</span>
                              ) : (
                                order.sources.map((source) => (
                                  <span
                                    key={source}
                                    className={`inline-flex rounded px-1.5 py-0.5 font-mono text-[11px] font-medium ${
                                      source === 'KK' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'
                                    }`}
                                  >
                                    {source}
                                  </span>
                                ))
                              )}
                            </div>
                          </td>
                          <td className="px-5 py-3 font-mono text-xs text-slate-500">{formatDateTime(order.last_synced_at)}</td>
                          <td className="px-5 py-3 text-right font-mono text-xs">{order.sync_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-5 py-16 text-center text-sm text-slate-400">
                  当前筛选条件下暂无订单，请调整过滤条件。
                </div>
              )}

              {/* 分页 */}
              <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 px-5 py-3">
                <span className="text-xs text-slate-500">
                  第 <span className="font-mono font-semibold text-slate-700">{page}</span> / {totalPages} 页
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="上一页"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="下一页"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </div>
              </div>
            </section>

            {/* 统计面板 */}
            <div className="flex flex-col gap-4">
              <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h2 className="text-sm font-semibold text-slate-800">月度分布</h2>
                  <p className="mt-1 text-xs text-slate-400">按计划开始日期（GSTRS）统计</p>
                </div>
                <div className="h-52 px-2 pb-2 pt-4">
                  {chartData.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-xs text-slate-400">
                      暂无可统计的计划开始日期
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
                        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                        <XAxis
                          dataKey="month"
                          tick={{ fontSize: 11, fill: '#94a3b8' }}
                          tickLine={false}
                          axisLine={false}
                          minTickGap={12}
                        />
                        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip
                          cursor={{ fill: '#f1f5f9' }}
                          contentStyle={{ borderRadius: 6, borderColor: '#e2e8f0', fontSize: 12 }}
                          formatter={(value) => [formatNumber(Number(value)), '订单数']}
                          labelFormatter={(label) => `月份 ${label}`}
                        />
                        <Bar dataKey="count" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={24} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </section>

              <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h2 className="text-sm font-semibold text-slate-800">机型分布</h2>
                  <p className="mt-1 text-xs text-slate-400">点击扇区或图例可切换筛选</p>
                </div>
                {modelData.length === 0 ? (
                  <p className="px-5 py-8 text-center text-xs text-slate-400">暂无机型分布数据</p>
                ) : (
                  <>
                    <div className="relative h-52 px-2 pt-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={modelData}
                            dataKey="count"
                            nameKey="key"
                            cx="50%"
                            cy="50%"
                            innerRadius={52}
                            outerRadius={78}
                            paddingAngle={2}
                            stroke="#ffffff"
                            strokeWidth={1.5}
                            onClick={(_, index) => {
                              const item = modelData[index];
                              if (item && item.key !== '其他') toggleDimension('cpXh', item.key);
                            }}
                          >
                            {modelData.map((item, index) => {
                              const active = item.key !== '其他' && filters.cpXh.includes(item.key);
                              return (
                                <Cell
                                  key={item.key}
                                  fill={BASE_COLORS[index % BASE_COLORS.length]}
                                  opacity={active ? 1 : 0.35}
                                  stroke={active ? '#0f172a' : '#ffffff'}
                                  strokeWidth={active ? 2 : 1}
                                  className="cursor-pointer outline-none"
                                />
                              );
                            })}
                          </Pie>
                          <Tooltip
                            contentStyle={{ borderRadius: 6, borderColor: '#e2e8f0', fontSize: 12 }}
                            formatter={(value) => [formatNumber(Number(value)), '订单数']}
                            labelFormatter={(label) => `机型 ${label}`}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-1">
                        <span className="text-2xl font-semibold text-slate-900">
                          {formatNumber(effectiveStats?.by_model.length ?? 0)}
                        </span>
                        <span className="text-xs text-slate-400">机型种类</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-5 pb-4 pt-2">
                      {modelData.map((item, index) => {
                        const isOther = item.key === '其他';
                        const active = !isOther && filters.cpXh.includes(item.key);
                        const ratio = effectiveStats ? (item.count / Math.max(effectiveStats.total, 1)) * 100 : 0;
                        return (
                          <button
                            key={item.key}
                            type="button"
                            disabled={isOther}
                            onClick={() => toggleDimension('cpXh', item.key)}
                            className={`flex min-w-0 items-center gap-2 rounded px-1.5 py-1 text-left transition-colors ${
                              isOther
                                ? 'cursor-default'
                                : `${active ? 'bg-blue-50/60' : ''} hover:bg-slate-50`
                            }`}
                          >
                            <span
                              className="size-2 shrink-0 rounded-full"
                              style={{ background: BASE_COLORS[index % BASE_COLORS.length] }}
                            />
                            <span
                              className={`truncate font-mono text-xs ${active ? 'font-semibold text-slate-900' : 'text-slate-600'}`}
                              title={item.key}
                            >
                              {item.key}
                            </span>
                            <span className="ml-auto shrink-0 text-[11px] text-slate-400">
                              {formatNumber(item.count)} · {ratio.toFixed(1)}%
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </section>

              <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h2 className="text-sm font-semibold text-slate-800">基地分布</h2>
                  <p className="mt-1 text-xs text-slate-400">点击扇区或图例可切换筛选</p>
                </div>
                {baseData.length === 0 ? (
                  <p className="px-5 py-8 text-center text-xs text-slate-400">暂无基地分布数据</p>
                ) : (
                  <>
                    <div className="relative h-52 px-2 pt-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={baseData}
                            dataKey="count"
                            nameKey="key"
                            cx="50%"
                            cy="50%"
                            innerRadius={52}
                            outerRadius={78}
                            paddingAngle={2}
                            stroke="#ffffff"
                            strokeWidth={1.5}
                            onClick={(_, index) => {
                              const item = baseData[index];
                              if (item) toggleDimension('lgort', item.key);
                            }}
                          >
                            {baseData.map((item, index) => {
                              const active = filters.lgort.includes(item.key);
                              return (
                                <Cell
                                  key={item.key}
                                  fill={BASE_COLORS[index % BASE_COLORS.length]}
                                  opacity={active ? 1 : 0.35}
                                  stroke={active ? '#0f172a' : '#ffffff'}
                                  strokeWidth={active ? 2 : 1}
                                  className="cursor-pointer outline-none"
                                />
                              );
                            })}
                          </Pie>
                          <Tooltip
                            contentStyle={{ borderRadius: 6, borderColor: '#e2e8f0', fontSize: 12 }}
                            formatter={(value) => [formatNumber(Number(value)), '订单数']}
                            labelFormatter={(label) => `基地 ${label}`}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-1">
                        <span className="text-2xl font-semibold text-slate-900">{formatNumber(effectiveStats?.total ?? 0)}</span>
                        <span className="text-xs text-slate-400">订单总数</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-5 pb-4 pt-2">
                      {baseData.map((item, index) => {
                        const active = filters.lgort.includes(item.key);
                        const ratio = effectiveStats ? (item.count / Math.max(effectiveStats.total, 1)) * 100 : 0;
                        return (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() => toggleDimension('lgort', item.key)}
                            className={`flex min-w-0 items-center gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-slate-50 ${active ? 'bg-blue-50/60' : ''}`}
                          >
                            <span
                              className="size-2 shrink-0 rounded-full"
                              style={{ background: BASE_COLORS[index % BASE_COLORS.length] }}
                            />
                            <span className={`truncate font-mono text-xs ${active ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>
                              {item.key}
                            </span>
                            <span className="ml-auto shrink-0 text-[11px] text-slate-400">
                              {formatNumber(item.count)} · {ratio.toFixed(1)}%
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </section>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1 px-1 pb-2 text-[11px] text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <span>
            销售订单数据每天 08:30、12:30、18:30、22:30 自动从 SG / KK 双来源同步，也可点击右上角「立即同步」手动拉取。
          </span>
          <span>按 AUFNR 去重入库 · 展示 sales_orders_sap 集合数据</span>
        </div>
      </main>

      {selectedOrder && (
        <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />
      )}

      {syncOpen && (
        <SyncSalesOrdersModal
          onClose={() => setSyncOpen(false)}
          onSynced={handleRefresh}
        />
      )}
    </div>
  );
}
