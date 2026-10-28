import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  FileSearch,
  LoaderCircle,
  RotateCcw,
  Search,
  SlidersHorizontal,
  XCircle,
} from 'lucide-react';
import { doaApi } from '../api/doaApi';
import { Modal } from '../components/ui/Modal';
import { MonthQuickPicker } from '../components/shared/MonthQuickPicker';
import { HelpTooltip } from '../components/shared/HelpTooltip';
import type { DoaRawDashboard, DoaRawFilters, DoaRawItem } from '../types/doa';

const EMPTY_RAW_FILTERS: DoaRawFilters = {};
const RAW_FILTER_KEYS: (keyof DoaRawFilters)[] = [
  'acceptedDateFrom', 'acceptedDateTo', 'keyword', 'serviceNumber', 'salesOrder',
  'serialNumber', 'customer', 'product', 'doaType', 'judgment', 'processingStatus',
];

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatPercent(value: number, total: number): string {
  return total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '0.0%';
}

function formatDate(value: unknown): string {
  if (!value) return '-';
  const text = String(value);
  return text.length > 16 ? text.slice(0, 16) : text;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function firstValue(values: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = values[key];
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return undefined;
}

function dataValue(item: DoaRawItem, ...keys: string[]): unknown {
  return firstValue(item.data as Record<string, unknown>, ...keys);
}

function StatCard({
  label,
  value,
  detail,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  tone: string;
  icon: typeof Database;
}) {
  return (
    <div className="border-b border-slate-100 px-5 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">{label}</span>
        <span className={`flex size-8 items-center justify-center rounded-md ${tone}`}>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-3 font-mono text-2xl font-semibold text-slate-900">{value}</p>
      <HelpTooltip label={`查看${label}说明`}>{detail}</HelpTooltip>
    </div>
  );
}

function DetailModal({ item, onClose }: { item: DoaRawItem; onClose: () => void }) {
  return (
    <Modal title={`DOA 记录详情 · ${item.id}`} onClose={onClose} maxWidth="max-w-4xl">
      <div className="space-y-5 p-5">
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">DOA 原始字段</h3>
          <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
            {Object.entries(item.data).map(([key, value]) => (
              <div key={key} className="min-w-0 border-b border-slate-100 pb-2">
                <dt className="text-xs text-slate-400">{key}</dt>
                <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">{displayValue(value)}</dd>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
}

export default function DoaScsPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<DoaRawDashboard | null>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<DoaRawFilters>(EMPTY_RAW_FILTERS);
  const [draft, setDraft] = useState<DoaRawFilters>(EMPTY_RAW_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<DoaRawItem | null>(null);

  const load = useCallback(async (targetPage: number, nextFilters: DoaRawFilters) => {
    setLoading(true);
    setError('');
    try {
      const result = await doaApi.getRaw(targetPage, 50, nextFilters);
      setData(result);
      setPage(result.pagination.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'DOA 数据加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(1, EMPTY_RAW_FILTERS);
  }, [load]);

  const setFilter = <K extends keyof DoaRawFilters>(key: K, value: DoaRawFilters[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const hasPendingFilters = RAW_FILTER_KEYS.some((key) => (draft[key] || '') !== (filters[key] || ''));
  const applyFilters = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = Object.fromEntries(
      Object.entries(draft).filter(([, value]) => value),
    ) as DoaRawFilters;
    setFilters(next);
    setDraft(next);
    setSelected(null);
    void load(1, next);
  };
  const resetFilters = () => {
    setFilters(EMPTY_RAW_FILTERS);
    setDraft(EMPTY_RAW_FILTERS);
    setSelected(null);
    void load(1, EMPTY_RAW_FILTERS);
  };

  const pagination = data?.pagination;
  const summary = data?.summary;
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={() => navigate('/')} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="返回首页" aria-label="返回首页">
              <ArrowLeft className="size-4" />
            </button>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white"><Database className="size-5" /></span>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-slate-900">SCS 数据明细</h1>
              <HelpTooltip label="查看 SCS 数据范围说明">仅显示 is_5000=true 的 DOA 原始数据。</HelpTooltip>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-4 px-4 py-5 sm:px-6 lg:px-8">
        {loading && !data ? (
          <div className="relative space-y-4">
            <div className="space-y-4 motion-safe:animate-pulse" aria-hidden="true"><div className="h-28 rounded-md border border-slate-200 bg-white" /><div className="h-80 rounded-md border border-slate-200 bg-white" /><div className="h-64 rounded-md border border-slate-200 bg-white" /></div>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center" role="status" aria-live="polite">
              <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white/95 px-4 py-3 text-sm font-medium text-slate-600 shadow-sm">
                <LoaderCircle className="size-4 animate-spin text-emerald-600 motion-reduce:animate-none" />
                <span>正在加载 DOA 数据</span>
              </div>
            </div>
          </div>
        ) : error && !data ? (
          <div className="flex min-h-[420px] flex-col items-center justify-center rounded-md border border-slate-200 bg-white text-center"><XCircle className="mb-3 size-8 text-rose-300" /><p className="text-sm font-medium text-slate-700">{error}</p><button type="button" onClick={() => load(page, filters)} className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">重新加载</button></div>
        ) : data && pagination ? (
          <>
            {error && <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">加载失败，当前展示上一次成功获取的数据。</div>}
            {summary && (
              <section className="grid overflow-hidden rounded-md border border-slate-200 bg-white sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="SCS 总记录" value={formatNumber(summary.total)} detail="当前原始数据范围" tone="bg-emerald-50 text-emerald-600" icon={Database} />
                <StatCard label="判定结果为是" value={formatNumber(summary.judgmentYes)} detail={`占比 ${formatPercent(summary.judgmentYes, summary.total)} · 否 ${formatNumber(summary.judgmentNo)}`} tone="bg-blue-50 text-blue-600" icon={CheckCircle2} />
                <StatCard label="判定结果为否" value={formatNumber(summary.judgmentNo)} detail={`占比 ${formatPercent(summary.judgmentNo, summary.total)}`} tone="bg-amber-50 text-amber-600" icon={XCircle} />
                <StatCard label="最近受理时间" value={formatDate(summary.latestAcceptedAt)} detail="按 SCS 受理日期统计" tone="bg-slate-100 text-slate-600" icon={CalendarDays} />
              </section>
            )}
            <section className="rounded-md border border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-5">
              <form onSubmit={applyFilters} className="grid grid-cols-1 gap-3 lg:grid-cols-12">
                <div className="flex items-center gap-2 lg:col-span-12"><SlidersHorizontal className="size-4 text-emerald-700" /><h2 className="text-sm font-semibold text-slate-800">排查筛选</h2><span className={`text-xs text-amber-700 ${hasPendingFilters ? '' : 'invisible'}`} aria-live="polite">筛选条件尚未应用</span></div>
                <div className="flex min-w-0 flex-col gap-1 lg:col-span-3"><span className="text-xs font-medium text-slate-600">受理日期</span><div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1"><input type="date" value={draft.acceptedDateFrom || ''} max={draft.acceptedDateTo || undefined} onChange={(event) => setFilter('acceptedDateFrom', event.target.value)} className="h-9 min-w-0 rounded-md border border-slate-300 px-2 text-xs" /><span className="text-xs text-slate-400">至</span><input type="date" value={draft.acceptedDateTo || ''} min={draft.acceptedDateFrom || undefined} onChange={(event) => setFilter('acceptedDateTo', event.target.value)} className="h-9 min-w-0 rounded-md border border-slate-300 px-2 text-xs" /></div><MonthQuickPicker from={draft.acceptedDateFrom || ''} to={draft.acceptedDateTo || ''} onChange={(from, to) => setDraft((current) => ({ ...current, acceptedDateFrom: from, acceptedDateTo: to }))} accent="emerald" defaultExpanded={false} /></div>
                <label className="flex min-w-0 flex-col gap-1 lg:col-span-3"><span className="text-xs font-medium text-slate-600">跨字段关键字</span><input value={draft.keyword || ''} onChange={(event) => setFilter('keyword', event.target.value)} placeholder="服务单、订单、SN、客户或产品" className="h-9 rounded-md border border-slate-300 px-2.5 text-sm" /></label>
                <label className="flex min-w-0 flex-col gap-1 lg:col-span-2"><span className="text-xs font-medium text-slate-600">服务单号</span><input value={draft.serviceNumber || ''} onChange={(event) => setFilter('serviceNumber', event.target.value)} placeholder="支持模糊查询" className="h-9 rounded-md border border-slate-300 px-2.5 text-sm font-mono" /></label>
                <label className="flex min-w-0 flex-col gap-1 lg:col-span-2"><span className="text-xs font-medium text-slate-600">销售订单</span><input value={draft.salesOrder || ''} onChange={(event) => setFilter('salesOrder', event.target.value)} placeholder="支持模糊查询" className="h-9 rounded-md border border-slate-300 px-2.5 text-sm font-mono" /></label>
                <div className="flex items-end gap-1.5 lg:col-span-2"><button type="submit" className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700"><Search className="size-4" />查询</button><button type="button" onClick={resetFilters} disabled={!RAW_FILTER_KEYS.some((key) => draft[key] || filters[key])} className="inline-flex size-9 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" title="重置筛选" aria-label="重置筛选"><RotateCcw className="size-4" /></button></div>
                <label className="flex min-w-0 flex-col gap-1 lg:col-span-2"><span className="text-xs font-medium text-slate-600">服务器/备件 SN</span><input value={draft.serialNumber || ''} onChange={(event) => setFilter('serialNumber', event.target.value)} placeholder="支持模糊查询" className="h-9 rounded-md border border-slate-300 px-2.5 text-sm font-mono" /></label>
                <label className="flex min-w-0 flex-col gap-1 lg:col-span-2"><span className="text-xs font-medium text-slate-600">客户</span><input value={draft.customer || ''} onChange={(event) => setFilter('customer', event.target.value)} placeholder="客户名称" className="h-9 rounded-md border border-slate-300 px-2.5 text-sm" /></label>
                <label className="flex min-w-0 flex-col gap-1 lg:col-span-2"><span className="text-xs font-medium text-slate-600">产品/备件</span><input value={draft.product || ''} onChange={(event) => setFilter('product', event.target.value)} placeholder="产品或备件名称" className="h-9 rounded-md border border-slate-300 px-2.5 text-sm" /></label>
                <label className="flex min-w-0 flex-col gap-1 lg:col-span-2"><span className="text-xs font-medium text-slate-600">DOA 类型</span><input list="scs-doa-types" value={draft.doaType || ''} onChange={(event) => setFilter('doaType', event.target.value)} placeholder="精确匹配" className="h-9 rounded-md border border-slate-300 px-2.5 text-sm" /><datalist id="scs-doa-types">{data.byType.map((item) => <option key={item.key} value={item.key} />)}</datalist></label>
                <label className="flex min-w-0 flex-col gap-1 lg:col-span-2"><span className="text-xs font-medium text-slate-600">处理状态</span><input list="scs-processing-statuses" value={draft.processingStatus || ''} onChange={(event) => setFilter('processingStatus', event.target.value)} placeholder="精确匹配" className="h-9 rounded-md border border-slate-300 px-2.5 text-sm" /><datalist id="scs-processing-statuses">{data.byProcessingStatus.map((item) => <option key={item.key} value={item.key} />)}</datalist></label>
                <label className="flex min-w-0 flex-col gap-1 lg:col-span-1"><span className="text-xs font-medium text-slate-600">判定</span><select value={draft.judgment || ''} onChange={(event) => setFilter('judgment', event.target.value)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"><option value="">全部</option><option value="是">是</option><option value="否">否</option></select></label>
              </form>
            </section>
            <section className="relative overflow-hidden rounded-md border border-slate-200 bg-white">
              {loading && <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/65 backdrop-blur-[1px]" role="status" aria-live="polite"><div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 shadow-sm"><LoaderCircle className="size-4 animate-spin text-emerald-600 motion-reduce:animate-none" /><span>正在刷新 DOA 数据</span></div></div>}
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><div className="flex items-center gap-1"><h2 className="text-sm font-semibold text-slate-800">DOA 明细</h2><HelpTooltip label="查看 DOA 明细说明">按受理时间倒序排列；点击记录可查看完整字段。</HelpTooltip></div><FileSearch className="size-4 text-slate-400" /></div>
              {data.items.length === 0 ? <div className="px-5 py-16 text-center text-sm text-slate-400">暂无 DOA 数据</div> : <div className="overflow-x-auto"><table className="w-full min-w-[1040px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-400"><tr><th className="px-5 py-2.5 font-medium">服务单号</th><th className="px-5 py-2.5 font-medium">受理时间</th><th className="px-5 py-2.5 font-medium">客户</th><th className="px-5 py-2.5 font-medium">产品/备件</th><th className="px-5 py-2.5 font-medium">DOA 类型</th><th className="px-5 py-2.5 font-medium">判定</th><th className="px-5 py-2.5 font-medium">处理状态</th><th className="px-5 py-2.5 font-medium">销售订单</th></tr></thead><tbody className="divide-y divide-slate-100">{data.items.map((item) => { const serviceNo = dataValue(item, '服务单号', '服务单号_id'); const acceptedAt = dataValue(item, '受理时间', '受理日期'); const customer = dataValue(item, '客户全称', '客户'); const product = dataValue(item, '产品/备件名称', '产品名称', '备件名称'); const salesOrder = dataValue(item, '销售订单号', '销售订单'); return <tr key={item.id} onClick={() => setSelected(item)} className="cursor-pointer text-slate-600 hover:bg-emerald-50/40"><td className="max-w-[180px] truncate px-5 py-3 font-medium text-slate-700" title={displayValue(serviceNo)}>{displayValue(serviceNo)}</td><td className="whitespace-nowrap px-5 py-3 text-xs">{formatDate(acceptedAt)}</td><td className="max-w-[160px] truncate px-5 py-3" title={displayValue(customer)}>{displayValue(customer)}</td><td className="max-w-[220px] truncate px-5 py-3" title={displayValue(product)}>{displayValue(product)}</td><td className="px-5 py-3">{displayValue(dataValue(item, 'DOA类型'))}</td><td className="px-5 py-3">{displayValue(dataValue(item, '判定结果'))}</td><td className="px-5 py-3">{displayValue(dataValue(item, '处理状态'))}</td><td className="px-5 py-3 font-mono text-xs">{displayValue(salesOrder)}</td></tr>; })}</tbody></table></div>}
              <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3"><span className="text-xs text-slate-400">第 {pagination.page} 页 · 共 {formatNumber(pagination.total)} 条</span><div className="flex items-center gap-2"><button type="button" onClick={() => load(page - 1, filters)} disabled={loading || page <= 1} className="flex size-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40" title="上一页" aria-label="上一页"><ChevronLeft className="size-4" /></button><button type="button" onClick={() => load(page + 1, filters)} disabled={loading || !pagination.hasMore} className="flex size-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40" title="下一页" aria-label="下一页"><ChevronRight className="size-4" /></button></div></div>
            </section>
          </>
        ) : null}
      </main>
      {selected && <DetailModal item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
