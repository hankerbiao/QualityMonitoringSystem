import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowLeft, BarChart3, CalendarDays, ChevronDown, Download, RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import * as XLSX from 'xlsx';
import { mfrApi } from '../api/mfrApi';
import { DashboardSwitcher } from '../components/shared/DashboardSwitcher';
import { DashboardLoading } from '../components/shared/DashboardLoading';
import { DateRangePicker } from '../components/shared/DateRangePicker';
import { HelpTooltip } from '../components/shared/HelpTooltip';
import type { MFRDashboard, MFRFilters } from '../types/mfr';
import { formatLocalDate } from '../utils/dateRange';

const number = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
const rate = (value: number | null) => value == null ? '—' : `${value.toFixed(2)}%`;
const sameFilters = (a: MFRFilters, b: MFRFilters) =>
  a.dateFrom === b.dateFrom && a.dateTo === b.dateTo && (a.model ?? '') === (b.model ?? '');

function exportStatistics(data: MFRDashboard, filters: MFRFilters) {
  const workbook = XLSX.utils.book_new();
  const overview = [
    { 指标: '统计开始日期', 数值: filters.dateFrom },
    { 指标: '统计结束日期', 数值: filters.dateTo },
    { 指标: '机型', 数值: filters.model || '全部机型' },
    { 指标: '综合 MFR（%）', 数值: data.summary.mfrRate },
    { 指标: '故障事件', 数值: data.summary.faultCount },
    { 指标: '在保台月', 数值: data.summary.fleetCount },
    { 指标: '全部订单中日期完整订单', 数值: data.summary.ordersWithWarrantyDates },
    { 指标: '全部订单中日期缺失订单', 数值: data.summary.ordersMissingWarrantyDates },
    { 指标: '全部订单日期完整率（%）', 数值: data.summary.warrantyDateCoverage },
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(overview), '质量概览');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.trend.map(item => ({
    统计月份: item.period, 故障事件: item.faultCount, 在保整机快照: item.fleetCount, 'MFR（%）': item.mfrRate,
  }))), '月度明细');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.byModel.map(item => ({
    机型: item.key, 故障事件: item.faultCount, 在保台月: item.fleetCount, 'MFR（%）': item.mfrRate,
  }))), '机型汇总');
  XLSX.writeFile(workbook, `MFR统计_${filters.dateFrom}_${filters.dateTo}.xlsx`);
}

function Metric({ label, value, detail, accent }: { label: string; value: string; detail: string; accent: string }) {
  return <div className="min-w-0 border-b border-slate-100 px-4 py-3 odd:border-r lg:border-b-0 lg:border-r lg:last:border-r-0">
    <div className="flex items-center gap-1"><p className="text-xs font-medium text-slate-500">{label}</p><HelpTooltip label={`查看${label}说明`}>{detail}</HelpTooltip></div>
    <p className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${accent}`}>{value}</p>
  </div>;
}

export default function MFRPage() {
  const [initialFilters] = useState<MFRFilters>(() => {
    const now = new Date();
    return { dateFrom: formatLocalDate(new Date(now.getFullYear(), now.getMonth(), 1)), dateTo: formatLocalDate(now), model: '' };
  });
  const [draft, setDraft] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [data, setData] = useState<MFRDashboard | null>(null);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedModel, setExpandedModel] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (next: MFRFilters) => {
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    setData(null);
    setExpandedModel(null);
    try {
      const result = await mfrApi.getDashboard(next);
      if (id !== requestId.current) return;
      setData(result);
      if (!next.model) setModelOptions(result.byModel.map(item => item.key));
    } catch (err) {
      if (id === requestId.current) setError(err instanceof Error ? err.message : 'MFR 数据加载失败');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load(initialFilters);
    return () => { requestId.current += 1; };
  }, [initialFilters, load]);

  const apply = (next: MFRFilters) => {
    if (!next.dateFrom || !next.dateTo || next.dateFrom > next.dateTo) {
      setError('请选择有效的日期范围');
      return;
    }
    const normalized = { ...next, model: next.model?.trim() ?? '' };
    setDraft(normalized);
    setFilters(normalized);
    void load(normalized);
  };
  const rankedModels = useMemo(() => [...(data?.byModel ?? [])]
    .sort((a, b) => (b.mfrRate ?? -1) - (a.mfrRate ?? -1)).slice(0, 10), [data]);
  const maxRate = Math.max(0, ...rankedModels.map(item => item.mfrRate ?? 0));
  const summary = data?.summary;
  const pending = !sameFilters(draft, filters);
  const dailyTrend = filters.dateFrom.slice(0, 7) === filters.dateTo.slice(0, 7) && Boolean(data?.dailyTrend?.length);
  const chartTrend = dailyTrend ? data?.dailyTrend ?? [] : data?.trend ?? [];

  return <div className="min-h-screen bg-[#f4f6f5] text-slate-800">
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex min-h-15 max-w-[1600px] items-center justify-between gap-2 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-2">
          <Link to="/" className="flex size-9 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" aria-label="返回首页" title="返回首页"><ArrowLeft className="size-4" /></Link>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-teal-700 text-white"><Activity className="size-4" /></span>
          <div className="flex min-w-0 items-center gap-1"><h1 className="truncate text-sm font-semibold text-slate-900 sm:text-base">MFR 整机现网月化故障率</h1><HelpTooltip label="查看 MFR 看板说明">现网质量的月度分析指标。</HelpTooltip></div>
        </div>
        <DashboardSwitcher />
      </div>
    </header>

    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-4 py-4 sm:px-6 lg:px-8">
      <section className="rounded-md border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal className="size-4 text-teal-700" />筛选条件</h2>
          <span className="text-xs text-slate-500">{filters.dateFrom} 至 {filters.dateTo} · {filters.model || '全部机型'}{pending && ' · 待应用'}</span>
        </div>
        <form onSubmit={event => { event.preventDefault(); apply(draft); }} className="flex flex-wrap items-end gap-2 px-4 py-3">
          <div className="w-full sm:w-80"><DateRangePicker label="统计日期" from={draft.dateFrom} to={draft.dateTo} disabled={loading} onChange={(dateFrom, dateTo) => setDraft(current => ({ ...current, dateFrom, dateTo }))} /></div>
          <label className="flex w-full flex-col gap-1 text-[11px] font-medium text-slate-600 sm:w-56">机型
            <input list="mfr-model-options" value={draft.model ?? ''} disabled={loading} onChange={event => setDraft(current => ({ ...current, model: event.target.value }))} placeholder="全部机型" className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-700 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100 disabled:opacity-50" />
            <datalist id="mfr-model-options">{modelOptions.map(model => <option key={model} value={model} />)}</datalist>
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={loading} className="flex h-9 items-center gap-1.5 rounded-md bg-teal-700 px-4 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"><Search className="size-4" />查询</button>
            <button type="button" disabled={loading || (sameFilters(filters, initialFilters) && sameFilters(draft, initialFilters))} onClick={() => apply(initialFilters)} className="flex size-9 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40" aria-label="重置筛选" title="重置筛选"><RotateCcw className="size-4" /></button>
          </div>
        </form>
      </section>

      {error && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertTriangle className="size-4 shrink-0" />{error}{!data && <button type="button" onClick={() => void load(filters)} className="ml-auto underline">重试</button>}</div>}
      {loading && <DashboardLoading dashboard="MFR" />}
      {data && summary && <>
        <section className="rounded-md border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3"><div className="flex items-center gap-1"><h2 className="text-sm font-semibold">质量概览</h2><HelpTooltip label="查看 MFR 统计口径与数据来源">
            <p>综合 MFR = 所选范围内故障事件数 ÷ 各月在保整机快照之和 × 100%。在保台月不是去重整机数；同一整机在多个月份在保时会分别计入。</p>
            <p className="mt-1">故障事件为关联销售订单的有效“换上”或“换上-up”记录，已排除撤销记录。分母按订单数量及完整的出厂、过保日期计算。</p>
            <p className="mt-1">快照取各月月末，尚未结束的月份取当前日期（UTC）。选中非完整月份时，故障事件仅取所选日期内的数据，分母仍按该月快照计算。订单日期完整率基于全部订单，不随机型筛选变化。</p>
            <p className="mt-1">数据来自销售订单、SCS 服务单和换件记录。</p>
          </HelpTooltip></div><span className="text-xs text-slate-500">{filters.dateFrom} 至 {filters.dateTo} · {filters.model || '全部机型'}</span></div>
          <div className="grid grid-cols-2 lg:grid-cols-4">
            <Metric label="综合 MFR" value={rate(summary.mfrRate)} detail="故障事件 ÷ 在保台月" accent="text-teal-700" />
            <Metric label="故障事件" value={number(summary.faultCount)} detail="有效换件记录" accent="text-slate-900" />
            <Metric label="在保台月" value={number(summary.fleetCount)} detail="各月在保整机快照之和" accent="text-slate-900" />
            <Metric label="日期完整订单" value={number(summary.ordersWithWarrantyDates)} detail={`全部订单 · 完整率 ${rate(summary.warrantyDateCoverage)}`} accent="text-slate-900" />
          </div>
          {summary.ordersMissingWarrantyDates > 0 && <div className="flex items-start gap-2 border-t border-amber-100 bg-amber-50 px-4 py-2 text-xs leading-5 text-amber-800"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />全部订单中有 {number(summary.ordersMissingWarrantyDates)} 个缺少完整的出厂或过保日期，无法计入在保快照；订单日期完整率不受机型筛选影响。</div>}
        </section>

        <section className="grid gap-3 lg:grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)]">
          <div className="min-w-0 rounded-md border border-slate-200 bg-white">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-1"><h2 className="flex items-center gap-2 text-sm font-semibold"><BarChart3 className="size-4 text-teal-700" />现网故障趋势</h2><HelpTooltip label="查看趋势统计方式">{dailyTrend ? '此处按日展示故障事件，MFR 保持月度口径。' : '此处按月展示故障事件及月化故障率。'}</HelpTooltip></div>
              <div className="flex gap-3 text-xs text-slate-500"><span><span className="mr-1 inline-block size-2 rounded-sm bg-teal-600" />故障事件</span>{!dailyTrend && <span><span className="mr-1 inline-block size-2 rounded-full bg-rose-500" />MFR</span>}</div>
            </div>
            <div className="h-[310px] px-1 py-4 sm:px-3">{chartTrend.length ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartTrend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="period" tickFormatter={dailyTrend ? (value: string) => value.slice(5) : undefined} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="events" allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
              {!dailyTrend && <YAxis yAxisId="rate" orientation="right" tickFormatter={(value: number) => `${value}%`} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />}
              <Tooltip formatter={(value, name) => [name === 'MFR' ? rate(typeof value === 'number' ? value : null) : number(Number(value)), name]} />
              <Bar yAxisId="events" dataKey="faultCount" name="故障事件" fill="#0d9488" radius={[2, 2, 0, 0]} maxBarSize={32} />
              {!dailyTrend && <Line yAxisId="rate" dataKey="mfrRate" name="MFR" type="monotone" stroke="#e11d48" strokeWidth={2} dot={{ r: 3, fill: '#e11d48' }} connectNulls={false} />}
            </ComposedChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center text-sm text-slate-400">暂无趋势数据</div>}</div>
          </div>
          <div className="min-w-0 rounded-md border border-slate-200 bg-white">
            <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-4 py-3"><div className="flex items-center gap-1"><h2 className="text-sm font-semibold">机型排行</h2><HelpTooltip label="查看机型排行说明">按 MFR 从高到低排列，最多显示前 10 项。</HelpTooltip></div><span className="text-xs text-slate-500">{number(data.byModel.length)} 个机型</span></div>
            <div className="px-4">{rankedModels.length ? rankedModels.map((item, index) => <div key={item.key} className="border-b border-slate-100 last:border-0">
              <button type="button" aria-expanded={expandedModel === item.key} onClick={() => setExpandedModel(expandedModel === item.key ? null : item.key)} className="flex w-full items-center gap-3 py-3 text-left hover:bg-slate-50">
                <span className="flex size-6 shrink-0 items-center justify-center rounded bg-slate-100 font-mono text-xs text-slate-500">{String(index + 1).padStart(2, '0')}</span>
                <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium" title={item.key}>{item.key}</span><span className="shrink-0 font-mono text-sm font-semibold text-teal-700">{rate(item.mfrRate)}</span></span><span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-teal-600" style={{ width: `${maxRate > 0 && item.mfrRate != null ? Math.max(0, item.mfrRate / maxRate * 100) : 0}%` }} /></span></span>
                <ChevronDown className={`size-4 shrink-0 text-slate-400 ${expandedModel === item.key ? 'rotate-180' : ''}`} />
              </button>
              {expandedModel === item.key && <div className="mb-3 ml-9 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600"><span>故障事件 {number(item.faultCount)} · 在保台月 {number(item.fleetCount)}</span><button type="button" onClick={() => apply({ ...filters, model: item.key })} className="font-medium text-teal-700 hover:underline">查看该机型趋势</button></div>}
            </div>) : <div className="py-20 text-center text-sm text-slate-400">暂无机型数据</div>}</div>
          </div>
        </section>

        <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3"><div className="flex items-center gap-1"><h2 className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="size-4 text-teal-700" />周期明细</h2><HelpTooltip label="查看周期明细说明">{data.trend.length} 个统计月。</HelpTooltip></div><button type="button" onClick={() => exportStatistics(data, filters)} className="flex h-9 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"><Download className="size-4" />导出统计数据</button></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-4 py-3">统计月份</th><th className="px-4 py-3 text-right">故障事件</th><th className="px-4 py-3 text-right">在保整机（快照）</th><th className="px-4 py-3 text-right">MFR</th></tr></thead><tbody className="divide-y divide-slate-100">{data.trend.map(item => <tr key={item.period} className="hover:bg-slate-50"><td className="px-4 py-3 font-mono">{item.period}</td><td className="px-4 py-3 text-right font-mono">{number(item.faultCount)}</td><td className="px-4 py-3 text-right font-mono">{number(item.fleetCount)}</td><td className="px-4 py-3 text-right font-mono font-semibold text-teal-700">{rate(item.mfrRate)}</td></tr>)}{!data.trend.length && <tr><td colSpan={4} className="px-4 py-12 text-center text-slate-400">暂无周期数据</td></tr>}</tbody></table></div>
        </section>

      </>}
    </main>
  </div>;
}
