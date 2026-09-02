import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, CalendarDays, Database, ExternalLink, Home, Info, RefreshCw, TriangleAlert } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { mfrApi } from '../api/mfrApi';
import type { MFRDashboard, MFRFilters } from '../types/mfr';
import { DashboardSwitcher } from '../components/shared/DashboardSwitcher';

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function monthStart(month: string): string { return `${month}-01`; }

function monthEnd(month: string): string {
  const [year, value] = month.split('-').map(Number);
  return `${month}-${String(new Date(year, value, 0).getDate()).padStart(2, '0')}`;
}

function fmt(value: number): string {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
}

function pct(value: number | null): string { return value == null ? '—' : `${value.toFixed(2)}%`; }

function RawDataLink({ tableName, label, search }: { tableName: string; label: string; search?: string }) {
  const query = search ? `?search=${encodeURIComponent(search)}` : '';
  return <Link to={`/metadata/${tableName}${query}`} className="inline-flex items-center gap-1 text-xs font-medium text-rose-700 hover:text-rose-900 hover:underline"><ExternalLink className="size-3" aria-hidden="true" />{label}</Link>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-md border border-slate-200 border-t-2 border-t-rose-500 bg-white p-4 shadow-sm"><p className="text-xs font-semibold text-slate-600">{label}</p><p className="mt-3 font-mono text-3xl font-bold text-slate-950">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div>;
}

export default function MFRPage() {
  const month = currentMonth();
  const [selectedFrom, setSelectedFrom] = useState('2026-01');
  const [selectedTo, setSelectedTo] = useState(month);
  const [model, setModel] = useState('');
  const [data, setData] = useState<MFRDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const filters = useMemo<MFRFilters>(() => ({ dateFrom: monthStart(selectedFrom), dateTo: monthEnd(selectedTo), model }), [selectedFrom, selectedTo, model]);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    if (selectedFrom > selectedTo) { setError('开始月份不能晚于结束月份'); setLoading(false); return; }
    try { setData(await mfrApi.getDashboard(filters)); } catch (err) { setError(err instanceof Error ? err.message : 'MFR 数据加载失败'); } finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { void load(); }, [load]);
  const models = data?.byModel ?? [];
  const summary = data?.summary;

  return <div className="min-h-screen bg-slate-100 text-slate-800">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3"><Link to="/" aria-label="返回首页" title="返回首页" className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"><Home className="size-4" />返回首页</Link><div><h1 className="text-lg font-semibold text-slate-950">MFR 整机现网月化故障率</h1><p className="text-xs text-slate-500">故障数 ÷ 统计时间点在保整机数量 × 100%</p></div></div>
      <div className="flex items-center gap-2"><DashboardSwitcher /><button type="button" onClick={() => void load()} disabled={loading} aria-label="刷新数据" title="刷新数据" className="inline-flex size-9 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50"><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /></button></div>
    </div></header>
    <main className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6 lg:px-8">
      <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800"><CalendarDays className="size-4 text-rose-600" />统计范围</div><div className="grid gap-3 sm:grid-cols-3"><label className="text-xs font-medium text-slate-700">开始月份<input type="month" value={selectedFrom} onChange={e => setSelectedFrom(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" /></label><label className="text-xs font-medium text-slate-700">结束月份<input type="month" value={selectedTo} onChange={e => setSelectedTo(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" /></label><label className="text-xs font-medium text-slate-700">机型<input value={model} onChange={e => setModel(e.target.value)} placeholder="全部机型" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" /></label></div></section>
      {error && <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {summary && summary.warrantyDateCoverage < 100 && <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><TriangleAlert className="mt-0.5 size-4 shrink-0" /><span>保有量日期覆盖率 {summary.warrantyDateCoverage.toFixed(2)}%，{fmt(summary.ordersMissingWarrantyDates)} 个销售订单缺少出厂日期或过保日期，未计入分母。</span></div>}
      <section className="grid gap-3 sm:grid-cols-3"><Metric label="整体 MFR" value={loading ? '…' : pct(summary?.mfrRate ?? null)} detail="故障事件数 ÷ 在保整机数" /><Metric label="当期故障数" value={loading ? '…' : fmt(summary?.faultCount ?? 0)} detail="有效换件事件数，重复故障分别计入" /><Metric label="当期保有量" value={loading ? '…' : fmt(summary?.fleetCount ?? 0)} detail="出厂日期 ≤ 统计时间点 ≤ 过保日期" /></section>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-slate-200 bg-white px-4 py-3"><span className="text-xs font-semibold text-slate-600">原始数据</span><RawDataLink tableName="sales_orders_sap" label="销售订单" /><RawDataLink tableName="scs_doa_results" label="SCS 服务单" /><RawDataLink tableName="scs_change_results" label="换件登记" /></div>
      <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Info className="size-4 text-rose-600" />计算口径与数据来源</div><div className="mt-3 grid gap-4 text-xs leading-5 text-slate-600 md:grid-cols-2"><div><p className="font-semibold text-slate-800">计算方法</p><p className="mt-1">MFR = 当期故障事件数 ÷ 当期在保整机数量 × 100%。每条有效“换上”/“换上-up”记录计为一次故障事件，同一台机器的多次故障分别计入。</p><p className="mt-1">月度趋势按每月最后一天计算在保数量；当前月份的统计点取今天。缺少出厂日期或过保日期的订单不计入分母，并在覆盖率提示中展示。</p></div><div><p className="font-semibold text-slate-800">数据来源</p><p className="mt-1"><Database className="mr-1 inline-block size-3.5 align-[-2px] text-slate-400" /><code>sales_orders_sap</code>：销售订单、机型、数量（优先使用已归一化的 quantity，缺失时回退 WMENG/GAMNG）、出厂日期和过保日期。</p><p className="mt-1"><Database className="mr-1 inline-block size-3.5 align-[-2px] text-slate-400" /><code>scs_doa_results</code>：服务单与销售订单的关联及生命周期日期补充。</p><p className="mt-1"><Database className="mr-1 inline-block size-3.5 align-[-2px] text-slate-400" /><code>scs_change_results</code>：统计范围内未撤销的“换上”/“换上-up”记录，每条记录作为一次故障事件。</p></div></div></section>
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]"><div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><BarChart3 className="size-4 text-rose-600" />月度趋势</div><div className="mt-4 h-[280px]">{loading ? <div className="flex h-full items-center justify-center text-sm text-slate-500">加载中…</div> : !data?.trend.length ? <div className="flex h-full items-center justify-center text-sm text-slate-500">暂无数据</div> : <ResponsiveContainer width="100%" height="100%"><LineChart data={data.trend} margin={{ top: 8, right: 12, bottom: 4, left: -15 }}><CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="period" tick={{ fontSize: 11 }} /><YAxis tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11 }} /><Tooltip formatter={(value) => [`${Number(value).toFixed(2)}%`, 'MFR']} /><Line type="monotone" dataKey="mfrRate" stroke="#e11d48" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} /></LineChart></ResponsiveContainer>}</div></div>
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"><h2 className="text-sm font-semibold text-slate-900">机型 MFR</h2><div className="mt-3 max-h-[330px] overflow-auto rounded-md border border-slate-200"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2">机型</th><th className="px-3 py-2 text-right">故障数</th><th className="px-3 py-2 text-right">保有量</th><th className="px-3 py-2 text-right">MFR</th></tr></thead><tbody className="divide-y divide-slate-100">{models.map(item => <tr key={item.key}><td className="max-w-[180px] truncate px-3 py-2 font-medium" title={item.key}><RawDataLink tableName="sales_orders_sap" label={item.key} search={item.key} /></td><td className="px-3 py-2 text-right font-mono">{fmt(item.faultCount)}</td><td className="px-3 py-2 text-right font-mono">{fmt(item.fleetCount)}</td><td className="px-3 py-2 text-right font-mono font-semibold text-rose-700">{pct(item.mfrRate)}</td></tr>)}{!models.length && <tr><td colSpan={4} className="px-3 py-10 text-center text-sm text-slate-500">暂无数据</td></tr>}</tbody></table></div></div></section>
    </main>
  </div>;
}
