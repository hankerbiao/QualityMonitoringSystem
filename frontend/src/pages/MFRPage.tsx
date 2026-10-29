import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, BarChart3, CalendarDays, ChevronDown, Download, Home, RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
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
const deviceIssueLabels: Record<string, string> = {
  companyUnverified: '公司归属未确认', doaStatusUnresolved: 'DOA 申报状态无法确认', salesOrderMismatch: '销售订单关联不一致', identityUnverified: '设备身份无法确认',
  identityConflict: '设备身份冲突', productionOrderUnresolved: '生产订单缺失或冲突',
  planDateUnresolved: '计划日期未匹配', planOrModelConflict: '计划日期或机型冲突',
};
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
    { 指标: 'DOA 设备数', 数值: data.summary.fleetCount },
    { 指标: '设备来源范围', 数值: '关联 5000 公司判定结果为“是”且非待受理的 DOA 申报，按生产订单计划开始日期筛选' },
    { 指标: '未能归属设备（全量）', 数值: Object.entries(data.summary.deviceIssues).filter(([key]) => key !== 'lifecycleDateIncomplete').reduce((sum, [, value]) => sum + value, 0) },
    { 指标: '所选设备日期缺失或冲突', 数值: data.summary.deviceIssues.lifecycleDateIncomplete ?? 0 },
    { 指标: '关联不明确的换件记录', 数值: data.summary.unmatchedChangeCount },
    { 指标: '故障统计口径', 数值: '所选设备唯一关联的有效换件，按生产订单计划开始日期归入周期；未限定换件发生时间；存在无法唯一关联的换件时相关故障率不显示' },
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(overview), '质量概览');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.trend.map(item => ({
    统计月份: item.period, 故障事件: item.faultCount, DOA设备数: item.fleetCount, 'MFR（%）': item.mfrRate,
  }))), '月度明细');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.byModel.map(item => ({
    机型: item.key, 故障事件: item.faultCount, DOA设备数: item.fleetCount, 'MFR（%）': item.mfrRate,
  }))), '机型汇总');
  XLSX.writeFile(workbook, `MFR统计_${filters.dateFrom}_${filters.dateTo}.xlsx`);
}

function Metric({ label, value, detail, accent }: { label: string; value: string; detail: string; accent: string }) {
  return <div className="min-w-0 px-3 py-2 sm:px-4">
    <div className="flex items-center gap-1"><span className={`size-2 rounded-full ${accent}`} /><p className="text-xs font-semibold text-slate-600">{label}</p><HelpTooltip label={`查看${label}说明`}>{detail}</HelpTooltip></div>
    <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-slate-950 sm:text-2xl">{value}</p>
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
  const [filtersExpanded, setFiltersExpanded] = useState(true);
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
  const unresolvedDevices = Object.entries(summary?.deviceIssues ?? {}).filter(([key]) => key !== 'lifecycleDateIncomplete').reduce((total, [, value]) => total + value, 0);
  const pending = !sameFilters(draft, filters);
  const dailyTrend = filters.dateFrom.slice(0, 7) === filters.dateTo.slice(0, 7) && Boolean(data?.dailyTrend?.length);
  const chartTrend = dailyTrend ? data?.dailyTrend ?? [] : data?.trend ?? [];

  return <div className="min-h-screen bg-[#f4f6f5] text-slate-800">
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex min-h-14 max-w-[1600px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Link to="/" className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700" aria-label="返回首页" title="返回首页"><Home className="size-4" />返回首页</Link>
          <div className="min-w-0"><div className="flex items-center gap-1"><h1 className="truncate text-lg font-semibold text-slate-950">MFR 现网质量看板</h1><HelpTooltip label="查看 MFR 看板说明">按 DOA 设备及其生产订单计划日期统计的换件故障指标。</HelpTooltip></div><p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-600"><Activity className="size-3 text-indigo-600" />DOA 设备 · 生产订单计划日期口径</p></div>
        </div>
        <DashboardSwitcher />
      </div>
    </header>

    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-2.5 px-4 py-3 sm:px-6 lg:px-8">
      <section className="border-y border-slate-200 bg-white">
        <div className="flex min-h-10 items-center gap-3 px-3 sm:px-4">
          <button type="button" aria-expanded={filtersExpanded} aria-controls={filtersExpanded ? 'mfr-filter-controls' : undefined} onClick={() => setFiltersExpanded(current => !current)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <SlidersHorizontal className="size-4 shrink-0 text-indigo-700" /><span className="shrink-0 text-sm font-semibold text-slate-800">筛选条件</span>
            <span className="truncate text-xs text-slate-500">{filters.dateFrom} 至 {filters.dateTo} · {filters.model || '全部机型'}{pending && ' · 待应用'}</span>
            <ChevronDown className={`size-4 shrink-0 text-slate-500 transition-transform ${filtersExpanded ? 'rotate-180' : ''}`} />
          </button>
          <button type="button" disabled={loading || (sameFilters(filters, initialFilters) && sameFilters(draft, initialFilters))} onClick={() => apply(initialFilters)} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-slate-600 hover:text-indigo-700 disabled:opacity-40" aria-label="重置筛选" title="重置筛选"><RotateCcw className="size-3.5" />重置</button>
        </div>
        {filtersExpanded && <form id="mfr-filter-controls" onSubmit={event => { event.preventDefault(); apply(draft); }} className="flex flex-wrap items-end gap-2 border-t border-slate-100 px-3 py-2 sm:px-4">
          <div className="w-full sm:w-80"><DateRangePicker label="生产订单计划日期" from={draft.dateFrom} to={draft.dateTo} disabled={loading} onChange={(dateFrom, dateTo) => setDraft(current => ({ ...current, dateFrom, dateTo }))} /></div>
          <label className="flex w-full flex-col gap-1 text-[11px] font-medium text-slate-600 sm:w-56">机型
            <input list="mfr-model-options" value={draft.model ?? ''} disabled={loading} onChange={event => setDraft(current => ({ ...current, model: event.target.value }))} placeholder="全部机型" className="h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-700 outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 disabled:opacity-50" />
            <datalist id="mfr-model-options">{modelOptions.map(model => <option key={model} value={model} />)}</datalist>
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={loading} className="flex h-9 items-center gap-1.5 rounded-md bg-indigo-700 px-4 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"><Search className="size-4" />查询</button>
          </div>
        </form>}
      </section>

      {error && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertTriangle className="size-4 shrink-0" />{error}{!data && <button type="button" onClick={() => void load(filters)} className="ml-auto underline">重试</button>}</div>}
      {loading && <DashboardLoading dashboard="MFR" />}
      {data && summary && <>
        <section className="border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 sm:px-4"><div className="flex items-center gap-1"><h2 className="text-sm font-semibold">质量概览</h2><HelpTooltip label="查看 MFR 统计口径与数据来源">
            <p>综合 MFR = 所选 DOA 设备的有效换件事件数 ÷ DOA 设备数 × 100%。设备需关联判定结果为“是”且非待受理的申报，按生产订单计划开始日期 GSTRS 筛选和归月，不判断是否在保。</p>
            <p className="mt-1">故障事件为设备唯一关联的未撤销“换上”或“换上-up”记录；换件发生时间不限制在筛选范围内。同一设备可有多条换件记录，因此比率可能超过 100%。关联不明确时，受影响的故障率显示为“—”。</p>
            <p className="mt-1">设备身份或生产订单计划日期无法唯一确定的记录单独统计；DOA 设备范围不代表全部现网设备。</p>
          </HelpTooltip></div><span className="text-xs text-slate-500">{filters.dateFrom} 至 {filters.dateTo} · {filters.model || '全部机型'}</span></div>
          <div className="grid grid-cols-2 divide-x divide-y divide-slate-200 lg:grid-cols-4 lg:divide-y-0">
            <Metric label="综合 MFR" value={rate(summary.mfrRate)} detail="所选 DOA 设备的有效换件事件数 ÷ DOA 设备数 × 100%。同一设备多次换件会重复计数。" accent="bg-indigo-600" />
            <Metric label="故障事件" value={number(summary.faultCount)} detail="所选设备可唯一关联的有效换件记录数；关联不明确的记录单独提示，不计入此数。" accent="bg-sky-500" />
            <Metric label="DOA 设备数" value={number(summary.fleetCount)} detail="关联判定为“是”且非待受理的 DOA 申报，生产订单计划日期和机型符合筛选条件的设备；按设备标识去重，不判断是否在保。" accent="bg-violet-500" />
            <Metric label="未归属设备" value={number(unresolvedDevices)} detail="数据源全量中申报状态或订单归属、设备身份、生产订单或计划日期无法唯一确定的设备，不受当前日期和机型筛选。" accent="bg-amber-500" />
          </div>
          {(unresolvedDevices > 0 || summary.unmatchedChangeCount > 0) && <div className="flex items-start gap-2 border-t border-amber-100 bg-amber-50 px-4 py-2 text-xs leading-5 text-amber-800"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /><div><p>数据源中有 {number(unresolvedDevices)} 台设备无法确认申报、订单或身份，未参与统计（不受日期和机型筛选）；所选设备关联服务单中有 {number(summary.unmatchedChangeCount)} 条换件记录无法唯一匹配设备，未计入故障事件，受影响的故障率暂不显示。</p>{unresolvedDevices > 0 && <details className="mt-1"><summary className="cursor-pointer font-semibold">查看未归属原因</summary><p className="mt-1">{Object.entries(summary.deviceIssues).filter(([key, value]) => key !== 'lifecycleDateIncomplete' && value > 0).map(([key, value]) => `${deviceIssueLabels[key] || key}：${number(value)} 台`).join(' · ')}</p></details>}</div></div>}
        </section>

        <section className="grid gap-2.5 lg:grid-cols-[minmax(0,1.8fr)_minmax(300px,1fr)]">
          <div className="min-w-0 border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 sm:px-4">
              <div className="flex items-center gap-1"><h2 className="flex items-center gap-2 text-sm font-semibold"><BarChart3 className="size-4 text-indigo-700" />现网故障趋势</h2><HelpTooltip label="查看趋势统计方式">{dailyTrend ? '此处按生产订单计划日期逐日展示关联换件事件，MFR 保持月度口径。' : '设备和关联换件事件均按生产订单计划日期归月；月度 MFR = 换件事件数 ÷ DOA 设备数 × 100%。'}</HelpTooltip></div>
              <div className="flex gap-3 text-xs text-slate-500"><span><span className="mr-1 inline-block size-2 rounded-sm bg-indigo-500" />故障事件</span>{!dailyTrend && <span><span className="mr-1 inline-block size-2 rounded-full bg-amber-700" />MFR</span>}</div>
            </div>
            <div className="h-[250px] px-1 pb-2 pt-3 sm:px-3">{chartTrend.length ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartTrend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="period" tickFormatter={dailyTrend ? (value: string) => value.slice(5) : undefined} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="events" allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
              {!dailyTrend && <YAxis yAxisId="rate" orientation="right" tickFormatter={(value: number) => `${value}%`} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />}
              <Tooltip formatter={(value, name) => [name === 'MFR' ? rate(typeof value === 'number' ? value : null) : number(Number(value)), name]} />
              <Bar yAxisId="events" dataKey="faultCount" name="故障事件" fill="#6366f1" radius={[2, 2, 0, 0]} maxBarSize={32} />
              {!dailyTrend && <Line yAxisId="rate" dataKey="mfrRate" name="MFR" type="monotone" stroke="#b45309" strokeWidth={2} dot={{ r: 3, fill: '#b45309' }} connectNulls={false} />}
            </ComposedChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center text-sm text-slate-400">暂无趋势数据</div>}</div>
          </div>
          <div className="min-w-0 border border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 sm:px-4"><div className="flex items-center gap-1"><h2 className="text-sm font-semibold">机型排行</h2><HelpTooltip label="查看机型排行说明">按 MFR 从高到低排列，最多显示前 10 项。</HelpTooltip></div><span className="text-xs text-slate-500">{number(data.byModel.length)} 个机型</span></div>
            <div className="max-h-[250px] overflow-y-auto px-3 sm:px-4">{rankedModels.length ? rankedModels.map((item, index) => <div key={item.key} className="border-b border-slate-100 last:border-0">
              <button type="button" aria-expanded={expandedModel === item.key} onClick={() => setExpandedModel(expandedModel === item.key ? null : item.key)} className="flex w-full items-center gap-3 py-2 text-left hover:bg-slate-50">
                <span className="flex size-6 shrink-0 items-center justify-center rounded bg-slate-100 font-mono text-xs text-slate-500">{String(index + 1).padStart(2, '0')}</span>
                <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium" title={item.key}>{item.key}</span><span className="shrink-0 font-mono text-sm font-semibold text-indigo-700">{rate(item.mfrRate)}</span></span><span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-indigo-500" style={{ width: `${maxRate > 0 && item.mfrRate != null ? Math.max(0, item.mfrRate / maxRate * 100) : 0}%` }} /></span></span>
                <ChevronDown className={`size-4 shrink-0 text-slate-400 ${expandedModel === item.key ? 'rotate-180' : ''}`} />
              </button>
              {expandedModel === item.key && <div className="mb-3 ml-9 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600"><span>故障事件 {number(item.faultCount)} · DOA 设备数 {number(item.fleetCount)}</span><button type="button" onClick={() => apply({ ...filters, model: item.key })} className="font-medium text-indigo-700 hover:underline">查看该机型趋势</button></div>}
            </div>) : <div className="py-20 text-center text-sm text-slate-400">暂无机型数据</div>}</div>
          </div>
        </section>

        <section className="border border-slate-200 bg-white">
          <div className="flex min-h-11 flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-3 sm:px-4"><div className="flex items-center gap-1"><h2 className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="size-4 text-indigo-700" />周期明细</h2><HelpTooltip label="查看周期明细说明">{data.trend.length} 个统计月。</HelpTooltip></div><button type="button" onClick={() => exportStatistics(data, filters)} className="flex h-8 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-xs font-medium text-slate-700 hover:bg-indigo-50"><Download className="size-4" />导出统计数据</button></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-4 py-2">统计月份</th><th className="px-4 py-2 text-right">故障事件</th><th className="px-4 py-2 text-right">DOA 设备数</th><th className="px-4 py-2 text-right">MFR</th></tr></thead><tbody className="divide-y divide-slate-100">{data.trend.map(item => <tr key={item.period} className="hover:bg-indigo-50/40"><td className="px-4 py-2 font-mono">{item.period}</td><td className="px-4 py-2 text-right font-mono">{number(item.faultCount)}</td><td className="px-4 py-2 text-right font-mono">{number(item.fleetCount)}</td><td className="px-4 py-2 text-right font-mono font-semibold text-indigo-700">{rate(item.mfrRate)}</td></tr>)}{!data.trend.length && <tr><td colSpan={4} className="px-4 py-12 text-center text-slate-400">暂无周期数据</td></tr>}</tbody></table></div>
        </section>

      </>}
    </main>
  </div>;
}
