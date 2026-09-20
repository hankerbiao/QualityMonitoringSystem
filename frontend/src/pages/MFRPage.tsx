import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Database,
  ExternalLink,
  RotateCcw,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { mfrApi } from '../api/mfrApi';
import type { MFRDashboard, MFRDimensionItem, MFRFilters } from '../types/mfr';
import { DashboardSwitcher } from '../components/shared/DashboardSwitcher';
import { MonthQuickPicker } from '../components/shared/MonthQuickPicker';

const DEFAULT_FROM = '2026-01';

function currentMonth(): string { return new Date().toISOString().slice(0, 7); }
function monthStart(month: string): string { return `${month}-01`; }
function monthEnd(month: string): string {
  const [year, value] = month.split('-').map(Number);
  return `${month}-${String(new Date(year, value, 0).getDate()).padStart(2, '0')}`;
}
function formatNumber(value: number): string { return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value); }
function formatRate(value: number | null): string { return value == null ? '—' : `${value.toFixed(2)}%`; }

function RawDataLink({ tableName, label, search }: { tableName: string; label: string; search?: string }) {
  const query = search ? `?search=${encodeURIComponent(search)}` : '';
  return <Link to={`/metadata/${tableName}${query}`} state={{ returnTo: '/mfr' }} className="inline-flex items-center gap-1 text-xs font-medium text-rose-700 transition-colors hover:text-rose-900 hover:underline"><ExternalLink className="size-3" aria-hidden="true" />{label}</Link>;
}

function SignalMetric({ label, value, detail, tone = 'light' }: { label: string; value: string; detail: string; tone?: 'light' | 'dark' }) {
  return <div className={tone === 'dark' ? 'border-l border-white/15 pl-4' : 'border-l-2 border-rose-500 pl-3'}><p className={tone === 'dark' ? 'text-xs text-white/60' : 'text-xs font-semibold text-slate-500'}>{label}</p><p className={tone === 'dark' ? 'mt-1 font-mono text-xl font-semibold text-white' : 'mt-2 font-mono text-2xl font-bold text-slate-950'}>{value}</p><p className={tone === 'dark' ? 'mt-1 text-[11px] text-white/50' : 'mt-1 text-xs text-slate-500'}>{detail}</p></div>;
}

function RiskRow({ item, rank, maxRate }: { item: MFRDimensionItem; rank: number; maxRate: number }) {
  const riskTone = item.mfrRate == null ? 'bg-slate-200' : item.mfrRate >= 2 ? 'bg-rose-500' : item.mfrRate >= 1 ? 'bg-amber-500' : 'bg-emerald-500';
  const width = item.mfrRate == null || maxRate <= 0 ? 0 : Math.max(5, Math.min(100, (item.mfrRate / maxRate) * 100));
  return <div className="border-b border-slate-100 py-3 last:border-0"><div className="flex items-center gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-slate-100 font-mono text-xs font-semibold text-slate-500">{String(rank).padStart(2, '0')}</span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><span className="truncate text-sm font-medium text-slate-700" title={item.key}><RawDataLink tableName="sales_orders_sap" label={item.key} search={item.key} /></span><span className="shrink-0 font-mono text-sm font-semibold text-rose-700">{formatRate(item.mfrRate)}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${riskTone}`} style={{ width: `${width}%` }} /></div><div className="mt-1 flex justify-between text-[11px] text-slate-400"><span>{formatNumber(item.faultCount)} 起故障事件</span><span>{formatNumber(item.fleetCount)} 台在保</span></div></div></div></div>;
}

export default function MFRPage() {
  const thisMonth = currentMonth();
  const initialFilters = useMemo<MFRFilters>(() => ({ dateFrom: monthStart(DEFAULT_FROM), dateTo: monthEnd(thisMonth), model: '' }), [thisMonth]);
  const [draftFrom, setDraftFrom] = useState(DEFAULT_FROM);
  const [draftTo, setDraftTo] = useState(thisMonth);
  const [draftModel, setDraftModel] = useState('');
  const [filters, setFilters] = useState<MFRFilters>(initialFilters);
  const [data, setData] = useState<MFRDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (nextFilters: MFRFilters) => {
    setLoading(true); setError('');
    try { setData(await mfrApi.getDashboard(nextFilters)); } catch (err) { setError(err instanceof Error ? err.message : 'MFR 数据加载失败'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(initialFilters); }, [initialFilters, load]);

  const applyFilters = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draftFrom || !draftTo || draftFrom > draftTo) { setError('开始月份不能晚于结束月份'); return; }
    const nextFilters = { dateFrom: monthStart(draftFrom), dateTo: monthEnd(draftTo), model: draftModel.trim() };
    setFilters(nextFilters); void load(nextFilters);
  };
  const resetFilters = () => { setDraftFrom(DEFAULT_FROM); setDraftTo(thisMonth); setDraftModel(''); setFilters(initialFilters); void load(initialFilters); };

  const summary = data?.summary;
  const trend = data?.trend ?? [];
  const models = data?.byModel ?? [];
  const rankedModels = useMemo(() => [...models].sort((a, b) => (b.mfrRate ?? -1) - (a.mfrRate ?? -1)).slice(0, 6), [models]);
  const maxRate = Math.max(...rankedModels.map((item) => item.mfrRate ?? 0), 0);
  const hasPendingChanges = filters.dateFrom !== monthStart(draftFrom) || filters.dateTo !== monthEnd(draftTo) || (filters.model ?? '') !== draftModel.trim();
  return <div className="min-h-screen bg-[#f6f8fb] text-slate-800">
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur"><div className="mx-auto flex min-h-15 max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8"><div className="flex min-w-0 items-center gap-2.5"><Link to="/" className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800" aria-label="返回首页" title="返回首页"><ArrowLeft className="size-4" /></Link><div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-rose-600 text-white"><Activity className="size-4" /></div><div className="min-w-0"><h1 className="truncate text-base font-semibold text-slate-900">MFR 整机现网月化故障率</h1><p className="hidden text-xs text-slate-500 sm:block">Field reliability / 在保整机质量信号</p></div></div><div className="flex shrink-0 items-center gap-1.5 sm:gap-2"><DashboardSwitcher /><button type="button" onClick={() => void load(filters)} disabled={loading} className="inline-flex size-9 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-45" aria-label="刷新数据" title="刷新数据"><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /></button></div></div></header>
    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-4 py-4 sm:px-6 lg:px-8">
      <section className="rounded-md border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5"><div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><SlidersHorizontal className="size-4 text-rose-600" />筛选范围</div><div className="flex items-center gap-2 text-xs text-slate-500"><CalendarDays className="size-3.5" />月度统计，按月末在保量计算</div></div><form onSubmit={applyFilters} className="grid gap-4 px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-[1fr_1fr_1.5fr_auto] lg:items-end"><label className="text-xs font-semibold text-slate-600">开始月份<input type="month" value={draftFrom} onChange={(event) => setDraftFrom(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-normal text-slate-700 outline-none transition focus:border-rose-500 focus:ring-2 focus:ring-rose-100" /></label><label className="text-xs font-semibold text-slate-600">结束月份<input type="month" value={draftTo} onChange={(event) => setDraftTo(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-normal text-slate-700 outline-none transition focus:border-rose-500 focus:ring-2 focus:ring-rose-100" /></label><label className="text-xs font-semibold text-slate-600">机型<input list="mfr-model-options" value={draftModel} onChange={(event) => setDraftModel(event.target.value)} placeholder="全部机型" className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-normal text-slate-700 outline-none transition focus:border-rose-500 focus:ring-2 focus:ring-rose-100" /><datalist id="mfr-model-options">{models.map((item) => <option key={item.key} value={item.key} />)}</datalist></label><div className="flex items-end gap-2 sm:col-span-2 lg:col-span-1"><button type="submit" className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md bg-rose-600 px-4 text-sm font-medium text-white transition-colors hover:bg-rose-700"><BarChart3 className="size-4" />应用</button><button type="button" onClick={resetFilters} disabled={!hasPendingChanges} className="inline-flex size-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" aria-label="重置筛选" title="重置筛选"><RotateCcw className="size-4" /></button></div><div className="sm:col-span-2 lg:col-span-2"><MonthQuickPicker mode="month" from={draftFrom} to={draftTo} onChange={(from, to) => { setDraftFrom(from); setDraftTo(to); }} accent="rose" defaultExpanded={false} /></div></form></section>
      {error && <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{error}</div>}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><SignalMetric label="综合 MFR" value={loading ? '…' : formatRate(summary?.mfrRate ?? null)} detail="故障事件 ÷ 在保整机" /><SignalMetric label="故障事件" value={loading ? '…' : formatNumber(summary?.faultCount ?? 0)} detail="撤销记录已排除" /><SignalMetric label="在保整机" value={loading ? '…' : formatNumber(summary?.fleetCount ?? 0)} detail="按统计点动态变化" /><SignalMetric label="纳入订单" value={loading ? '…' : formatNumber(summary?.ordersWithWarrantyDates ?? 0)} detail="具备完整生命周期日期" /></section>
      <section className="grid gap-3 lg:grid-cols-[minmax(0,1.65fr)_minmax(340px,1fr)]"><div className="rounded-md border border-slate-200 bg-white shadow-sm"><div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5"><div><div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><BarChart3 className="size-4 text-rose-600" />现网故障趋势</div><p className="mt-1 text-xs text-slate-500">柱状图显示故障事件，折线显示同期 MFR</p></div><span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><span className="size-2 rounded-full bg-rose-500" />故障事件 <span className="ml-2 size-2 rounded-full bg-slate-500" />MFR</span></div><div className="h-[310px] px-2 pb-3 pt-5 sm:px-5">{loading ? <div className="flex h-full items-center justify-center text-sm text-slate-400">正在加载趋势...</div> : trend.length ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}><CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="period" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} /><YAxis yAxisId="events" allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} /><YAxis yAxisId="rate" orientation="right" tickFormatter={(value: number) => `${value}%`} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} /><Tooltip formatter={(value, name) => [name === 'mfrRate' ? `${Number(value).toFixed(2)}%` : formatNumber(Number(value)), name === 'mfrRate' ? 'MFR' : '故障事件']} /><Bar yAxisId="events" dataKey="faultCount" name="faultCount" fill="#e11d48" radius={[2, 2, 0, 0]} maxBarSize={32} /><Line yAxisId="rate" dataKey="mfrRate" name="mfrRate" type="monotone" stroke="#475569" strokeWidth={2.5} dot={{ r: 3, fill: '#475569', strokeWidth: 0 }} connectNulls={false} /></ComposedChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center border border-dashed border-slate-200 text-sm text-slate-400">暂无趋势数据</div>}</div></div><div className="rounded-md border border-slate-200 bg-white shadow-sm"><div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5"><div><div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><AlertTriangle className="size-4 text-amber-500" />机型风险排行</div><p className="mt-1 text-xs text-slate-500">按 MFR 从高到低，最多展示 6 个机型</p></div><span className="font-mono text-xs text-slate-400">{models.length} 个机型</span></div><div className="px-4 sm:px-5">{loading ? <div className="flex h-[310px] items-center justify-center text-sm text-slate-400">正在计算风险...</div> : rankedModels.length ? rankedModels.map((item, index) => <RiskRow key={item.key} item={item} rank={index + 1} maxRate={maxRate} />) : <div className="flex h-[310px] items-center justify-center text-sm text-slate-400">暂无机型数据</div>}</div></div></section>
      <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5"><div><div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><CalendarDays className="size-4 text-rose-600" />月度快照</div><p className="mt-1 text-xs text-slate-500">每个月末的在保整机规模与故障事件对照</p></div><span className="text-xs text-slate-500">共 {trend.length} 个统计月</span></div><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-slate-50 text-xs font-semibold text-slate-600"><tr><th className="px-4 py-3 sm:px-5">统计月份</th><th className="px-4 py-3 text-right sm:px-5">故障事件</th><th className="px-4 py-3 text-right sm:px-5">在保整机</th><th className="px-4 py-3 text-right sm:px-5">MFR</th><th className="px-4 py-3 text-right sm:px-5">数据状态</th></tr></thead><tbody className="divide-y divide-slate-100">{trend.map((item) => <tr key={item.period} className="transition-colors hover:bg-rose-50/30"><td className="px-4 py-3 font-mono font-medium text-slate-800 sm:px-5">{item.period}</td><td className="px-4 py-3 text-right font-mono sm:px-5">{formatNumber(item.faultCount)}</td><td className="px-4 py-3 text-right font-mono sm:px-5">{formatNumber(item.fleetCount)}</td><td className="px-4 py-3 text-right font-mono font-semibold text-rose-700 sm:px-5">{formatRate(item.mfrRate)}</td><td className="px-4 py-3 text-right sm:px-5"><span className="inline-flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="size-3.5" />已纳入</span></td></tr>)}{!loading && !trend.length && <tr><td colSpan={5} className="px-4 py-14 text-center text-sm text-slate-400">暂无月度快照</td></tr>}</tbody></table></div></section>
      <section className="grid gap-3 lg:grid-cols-[1.25fr_1fr]"><div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><ShieldCheck className="size-4 text-emerald-600" />统计口径</div><div className="mt-3 grid gap-3 text-xs leading-5 text-slate-600 sm:grid-cols-2"><p>MFR = 当期有效故障事件数 ÷ 当期在保整机数量 × 100%。每条有效“换上”或“换上-up”记录计为一次故障事件，同一台机器的多次故障分别计入。</p><p>月度统计点为每月最后一天，当前月份取今天。只有同时具备出厂日期和过保日期的销售订单，才会进入在保数量分母。</p></div></div><div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Database className="size-4 text-rose-600" />数据来源</div><div className="mt-3 space-y-2 text-xs leading-5 text-slate-600"><p><code>sales_orders_sap</code> 提供订单、机型、数量和生命周期日期。</p><p><code>scs_doa</code> 关联 5000 范围内服务单与销售订单，<code>scs_change</code> 提供换件事件。</p></div></div></section>
    </main>
  </div>;
}
