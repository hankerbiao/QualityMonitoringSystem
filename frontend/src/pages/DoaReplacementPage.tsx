import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarDays, ChevronRight, Clock, Filter, Home, Package, RotateCcw } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { doaApi } from '../api/doaApi';
import type { DoaFilters, DoaOptions, DoaTimeGranularity, ReplacementDashboard, ReplacementTrendItem } from '../types/doa';

const defaultFilters: DoaFilters = { dateFrom: '', dateTo: '', customer: '', model: '', timeGranularity: 'month' };

function readFilters(params: URLSearchParams): DoaFilters {
  const granularity = params.get('timeGranularity');
  return {
    dateFrom: params.get('dateFrom') || '',
    dateTo: params.get('dateTo') || '',
    customer: params.get('customer') || '',
    model: params.get('model') || '',
    timeGranularity: granularity === 'year' || granularity === 'day' ? granularity : 'month',
  };
}

function num(value: number) { return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value); }
function rate(value: number | null) { return value == null ? '—' : `${value.toFixed(2)}%`; }
function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function periodLabel(value: string) {
  if (value.length === 7) return value.replace('-', '.');
  if (value.length === 10) return value.slice(5).replace('-', '.');
  return value;
}

function filtersForPeriod(filters: DoaFilters, period: string): DoaFilters {
  if (filters.timeGranularity === 'day') return { ...filters, dateFrom: period, dateTo: period };
  if (filters.timeGranularity === 'year') return { ...filters, dateFrom: `${period}-01-01`, dateTo: `${period}-12-31` };
  const [year, month] = period.split('-').map(Number);
  if (!year || !month) return filters;
  const lastDay = String(new Date(year, month, 0).getDate()).padStart(2, '0');
  return { ...filters, dateFrom: `${period}-01`, dateTo: `${period}-${lastDay}` };
}

function Stat({ label, value, detail, tone, edge }: { label: string; value: ReactNode; detail: string; tone: string; edge: string }) {
  return (
    <div className={`rounded-lg border border-slate-200 border-t-2 bg-white p-4 shadow-sm ${edge}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold text-slate-700">{label}</span>
        <span className={`flex size-8 shrink-0 items-center justify-center rounded-md ${tone}`}><Package className="size-4" /></span>
      </div>
      <p className="mt-3 font-mono text-3xl font-bold tracking-normal text-slate-950">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

export default function DoaReplacementPage() {
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState<DoaFilters>(() => readFilters(params));
  const [options, setOptions] = useState<DoaOptions>({ customers: [], models: [] });
  const [data, setData] = useState<ReplacementDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (next: DoaFilters) => {
    setLoading(true); setError('');
    try { setData(await doaApi.getReplacementDashboard(next)); } catch (err) { setError(err instanceof Error ? err.message : 'DOA 换件率数据加载失败'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { doaApi.getOptions().then(setOptions).catch(() => undefined); load(filters); }, [load]);

  const apply = (patch: Partial<DoaFilters>) => {
    const next = { ...filters, ...patch };
    setFilters(next); setParams(new URLSearchParams(doaApi.buildQuery(next))); load(next);
  };
  const reset = () => apply(defaultFilters);
  const summary = data?.summary;
  const topCustomers = [...(data?.byCustomer || [])].sort((a, b) => (b.replacementRate ?? -1) - (a.replacementRate ?? -1)).slice(0, 20);
  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/" aria-label="返回首页" title="返回首页" className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"><Home className="size-4" />返回首页</Link>
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold text-slate-950">DOA 换件率看板</p>
              <p className="truncate text-xs text-slate-600">DOA 报修数中按服务单号匹配换上换下</p>
              <p className="mt-1 flex items-center gap-1.5 text-[11px]"><span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700"><Clock className="size-3" aria-hidden="true" />数据更新至 {formatDateTime(summary?.latestDataAt)}</span></p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Link to="/doa" className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-slate-600 hover:text-sky-700">报修率看板 <ChevronRight className="size-4" /></Link>
            <Link to="/doa/raw" className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-slate-600 hover:text-sky-700">SCS 原始数据 <ChevronRight className="size-4" /></Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6 lg:px-8">
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Filter className="size-4 text-sky-600" />多维筛选</div>
            <button type="button" onClick={reset} className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 transition-colors hover:text-sky-700"><RotateCcw className="size-3.5" />重置</button>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <label className="text-xs font-medium text-slate-700">开始日期<input type="date" value={filters.dateFrom} onChange={e => apply({ dateFrom: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20" /></label>
            <label className="text-xs font-medium text-slate-700">结束日期<input type="date" value={filters.dateTo} onChange={e => apply({ dateTo: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20" /></label>
            <label className="text-xs font-medium text-slate-700">客户<select value={filters.customer} onChange={e => apply({ customer: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20"><option value="">全部客户</option>{options.customers.map(v => <option key={v}>{v}</option>)}</select></label>
            <label className="text-xs font-medium text-slate-700">机型<select value={filters.model} onChange={e => apply({ model: e.target.value })} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20"><option value="">全部机型</option>{options.models.map(v => <option key={v}>{v}</option>)}</select></label>
            <label className="text-xs font-medium text-slate-700">趋势粒度<select value={filters.timeGranularity} onChange={e => apply({ timeGranularity: e.target.value as DoaTimeGranularity })} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20"><option value="year">按年</option><option value="month">按月</option><option value="day">按日</option></select></label>
          </div>
        </section>
        {error && <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        <section className="grid gap-3 sm:grid-cols-3">
          <Stat label="DOA 换件率" value={loading ? '…' : rate(summary?.replacementRate ?? null)} detail="换件 DOA ÷ 出货数" tone="bg-sky-100 text-sky-700" edge="border-t-sky-500" />
          <Stat label="换件 DOA 数" value={loading ? '…' : <Link className="text-blue-700 underline-offset-2 hover:underline" to={`/doa/repairs?${doaApi.buildQuery(filters, { replacementOnly: 'true' })}`}>{num(summary?.replacementCount ?? 0)}</Link>} detail="点击进入换件明细与导出" tone="bg-amber-100 text-amber-700" edge="border-t-amber-500" />
          <Stat label="出货数量" value={loading ? '…' : num(summary?.shippedCount ?? 0)} detail={`已匹配 ${summary?.matchedRepairRecords ?? 0} 条 DOA`} tone="bg-blue-100 text-blue-700" edge="border-t-blue-500" />
        </section>
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.8fr)_minmax(280px,1fr)]">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">周期趋势</h2>
                <p className="mt-1 text-xs text-slate-600">DOA 换件率 · 出货按 GSTRS，换件按 DOA 受理日期</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700"><span className="size-2 rounded-full bg-sky-600" aria-hidden="true" />DOA 换件率</span>
                <CalendarDays className="size-4 text-slate-500" />
              </div>
            </div>
            <div className="h-[260px] px-2 pb-2 pt-5 sm:px-5">
              {loading ? <div className="flex h-full items-center justify-center text-sm text-slate-500">加载中…</div> : !data?.trend.length ? <div className="flex h-full items-center justify-center text-sm text-slate-500">暂无周期趋势数据</div> : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.trend} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                    <CartesianGrid stroke="#cbd5e1" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="period" tickFormatter={periodLabel} tick={{ fontSize: 12, fill: '#475569' }} tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis tickFormatter={(value: number) => `${value}%`} tick={{ fontSize: 12, fill: '#475569' }} tickLine={false} axisLine={false} width={48} domain={[0, 'auto']} />
                    <Tooltip labelFormatter={(label) => `周期 ${label}`} formatter={(value) => [value == null ? '—' : `${Number(value).toFixed(2)}%`, 'DOA 换件率']} contentStyle={{ borderRadius: 8, borderColor: '#cbd5e1', fontSize: 12, boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)' }} />
                    <Line type="monotone" dataKey="replacementRate" stroke="#0369a1" strokeWidth={2.75} dot={{ r: 3.5, fill: '#0369a1', strokeWidth: 0 }} activeDot={{ r: 6, fill: '#075985', stroke: '#f0f9ff', strokeWidth: 3 }} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="border-t border-slate-200">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-100">
                      <th className="px-4 py-3 text-xs font-semibold text-slate-700">时间</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-700">换件 DOA 数</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-700">服务器当期到货数</th>
                      <th className="px-4 py-3 text-xs font-semibold text-slate-700">DOA 换件率</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(data?.trend || []).map((item: ReplacementTrendItem) => (
                      <tr key={item.period} className="odd:bg-white even:bg-slate-50/70 transition-colors hover:bg-sky-50/40">
                        <td className="px-4 py-3 font-medium text-slate-800">{item.period}</td>
                        <td className="px-4 py-3 font-mono text-slate-800"><Link className="text-blue-700 underline-offset-2 hover:underline" to={`/doa/repairs?${doaApi.buildQuery(filtersForPeriod(filters, item.period), { replacementOnly: 'true' })}`}>{num(item.replacementCount)}</Link></td>
                        <td className="px-4 py-3 font-mono text-slate-800">{num(item.shippedCount)}</td>
                        <td className="px-4 py-3 font-mono font-semibold text-sky-700">{rate(item.replacementRate)}</td>
                      </tr>
                    ))}
                    {!data?.trend.length && <tr><td colSpan={4} className="px-4 py-16 text-center text-sm text-slate-500">暂无周期统计数据</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">客户换件率</h2>
              <span className="text-xs font-medium text-slate-500">TOP 20</span>
            </div>
            <div className="mt-3 max-h-[440px] divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
              {topCustomers.map(item => (
                <div key={item.key} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-sky-50/40">
                  <span className="truncate font-medium text-slate-700" title={item.key}>{item.key}</span>
                  <span className="shrink-0 font-mono font-semibold text-sky-700">{rate(item.replacementRate)}</span>
                </div>
              ))}
              {!data?.byCustomer.length && <p className="px-3 py-12 text-center text-sm text-slate-500">暂无数据</p>}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
