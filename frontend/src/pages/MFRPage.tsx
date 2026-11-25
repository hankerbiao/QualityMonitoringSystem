import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, BarChart3, CalendarDays, Download, Home, RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import * as XLSX from 'xlsx';
import { mfrApi } from '../api/mfrApi';
import { DashboardSwitcher } from '../components/shared/DashboardSwitcher';
import { DashboardLoading } from '../components/shared/DashboardLoading';
import { DateRangePicker } from '../components/shared/DateRangePicker';
import { HelpTooltip } from '../components/shared/HelpTooltip';
import type { MFRDashboard, MFRExport, MFRFilters } from '../types/mfr';
import { formatLocalDate } from '../utils/dateRange';

const number = (value: number | null) => value == null ? "—" : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
const rate = (value: number | null) => value == null ? '—' : `${value.toFixed(2)}%`;
const deviceIssueLabels: Record<string, string> = {
  doaStatusUnresolved: 'DOA 申报状态无法确认',
  identityUnverified: '设备身份无法确认',
  identityConflict: '设备身份冲突',
};
const sameFilters = (a: MFRFilters, b: MFRFilters) =>
  a.dateFrom === b.dateFrom && a.dateTo === b.dateTo;

function exportStatistics(data: MFRExport, filters: MFRFilters) {
  const workbook = XLSX.utils.book_new();
  const overview = [
    { 指标: '统计开始日期', 数值: filters.dateFrom },
    { 指标: '统计结束日期', 数值: filters.dateTo },
    { 指标: '综合 MFR（%）', 数值: data.summary.mfrRate },
    { 指标: '故障整机', 数值: data.summary.faultCount },
    { 指标: '期间出货台数', 数值: data.summary.fleetCount },
    { 指标: '未能归属设备（全量）', 数值: Object.entries(data.summary.deviceIssues).filter(([key]) => key !== 'lifecycleDateIncomplete' && key !== 'faultDateUnresolved').reduce((sum, [, value]) => sum + value, 0) },
    { 指标: '所选设备日期缺失或冲突', 数值: data.summary.deviceIssues.lifecycleDateIncomplete ?? 0 },
    { 指标: '关联不明确的换件记录', 数值: data.summary.unmatchedChangeCount },
    { 指标: '故障统计口径', 数值: '按 DOA 申报单号中的日期统计，同一整机每个自然月计一次' },
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(overview), '质量概览');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.trend.map(item => ({
    统计月份: item.period, 故障整机: item.faultCount, 累计出货台数: item.fleetCount, 'MFR（%）': item.mfrRate,
  }))), '月度明细');
  const headers = ['机型', '故障日期', 'DOA申报单号', '发货日期', '生产订单号', '设备SN', '服务单号', '换件记录ID', '换件类型', '换件时间', '物料编码', '部件SN', '部件名称', '客户'];
  const rows = data.faultDetails.map(item => [item.model, item.faultDate, item.doaCode, item.shipmentDate, item.productionOrder,
    item.deviceSn, item.serviceOrder, item.changeId, item.changeType, item.occurredAt,
    item.partNumber, item.partSn, item.partName, item.customer]);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, ...rows]), '故障明细');
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
    return { dateFrom: formatLocalDate(new Date(now.getFullYear(), now.getMonth(), 1)), dateTo: formatLocalDate(now) };
  });
  const [draft, setDraft] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [data, setData] = useState<MFRDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const requestId = useRef(0);

  const load = useCallback(async (next: MFRFilters) => {
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    setData(null);
    try {
      const result = await mfrApi.getDashboard(next);
      if (id !== requestId.current) return;
      setData(result);
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
    setDraft(next);
    setFilters(next);
    void load(next);
  };
  const summary = data?.summary;
  const unresolvedDevices = Object.entries(summary?.deviceIssues ?? {}).filter(([key]) => key !== 'lifecycleDateIncomplete' && key !== 'faultDateUnresolved').reduce((total, [, value]) => total + value, 0);
  const pending = !sameFilters(draft, filters);
  const dailyTrend = filters.dateFrom.slice(0, 7) === filters.dateTo.slice(0, 7) && Boolean(data?.dailyTrend?.length);
  const showMfrTrend = !dailyTrend && (data?.trend.some(item => item.mfrRate != null) ?? false);
  const chartTrend = dailyTrend ? data?.dailyTrend ?? [] : data?.trend ?? [];
  const exportCurrent = async () => {
    setExporting(true);
    setExportError('');
    try {
      const result = await mfrApi.getExport(filters);
      exportStatistics(result, result.filters);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  return <div className="min-h-screen bg-[#f4f6f5] text-slate-800">
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex min-h-14 max-w-[1600px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Link to="/" className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700" aria-label="返回首页" title="返回首页"><Home className="size-4" />返回首页</Link>
          <div className="min-w-0"><div className="flex items-center gap-1"><h1 className="truncate text-lg font-semibold text-slate-950">MFR 现网质量看板</h1><HelpTooltip label="查看 MFR 看板说明">按 SCS 销售订单号的 XNC 前缀判定 5000 公司归属，按 DOA 申报单号中的日期统计故障整机。</HelpTooltip></div><p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-600"><Activity className="size-3 text-indigo-600" />DOA 申报日期</p></div>
        </div>
        <DashboardSwitcher />
      </div>
    </header>

    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-2.5 px-4 py-3 sm:px-6 lg:px-8">
      <section className="border-y border-slate-200 bg-white">
        <div className="flex min-h-10 items-center gap-3 px-3 sm:px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <SlidersHorizontal className="size-4 shrink-0 text-indigo-700" /><span className="shrink-0 text-sm font-semibold text-slate-800">筛选条件</span>
            <span className="truncate text-xs text-slate-500">{filters.dateFrom} 至 {filters.dateTo}{pending && ' · 待应用'}</span>
          </div>
          <button type="button" disabled={loading || (sameFilters(filters, initialFilters) && sameFilters(draft, initialFilters))} onClick={() => apply(initialFilters)} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-slate-600 hover:text-indigo-700 disabled:opacity-40" aria-label="重置筛选" title="重置筛选"><RotateCcw className="size-3.5" />重置</button>
        </div>
        <form id="mfr-filter-controls" onSubmit={event => { event.preventDefault(); apply(draft); }} className="flex flex-wrap items-end gap-2 border-t border-slate-100 px-3 py-2 sm:px-4">
          <div className="w-full sm:w-80"><DateRangePicker label="故障日期" from={draft.dateFrom} to={draft.dateTo} disabled={loading} onChange={(dateFrom, dateTo) => setDraft(current => ({ ...current, dateFrom, dateTo }))} /></div>
          <div className="flex gap-2">
            <button type="submit" disabled={loading} className="flex h-9 items-center gap-1.5 rounded-md bg-indigo-700 px-4 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"><Search className="size-4" />查询</button>
          </div>
        </form>
      </section>

      {error && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertTriangle className="size-4 shrink-0" />{error}{!data && <button type="button" onClick={() => void load(filters)} className="ml-auto underline">重试</button>}</div>}
      {loading && <DashboardLoading dashboard="MFR" />}
      {data && summary && <>
        <section className="border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 sm:px-4"><div className="flex items-center gap-1"><h2 className="text-sm font-semibold">质量概览</h2><HelpTooltip label="查看 MFR 统计口径与数据来源">
            <p>月度 MFR = 当月故障整机数 ÷ 从所选开始日至当月统计截止日的累计出货整机数 × 100%。</p>
            <p className="mt-1">故障日期取自 DOA 申报单号；同一整机每个自然月计一次。</p>

          </HelpTooltip></div><span className="text-xs text-slate-500">{filters.dateFrom} 至 {filters.dateTo} · {filters.model || '全部机型'} · {(filters.customerIds?.length ? filters.customerIds.join('、') : '全部客户ID')}</span></div>
          <div className="grid grid-cols-2 divide-x divide-y divide-slate-200 lg:grid-cols-4 lg:divide-y-0">
            <Metric label="综合 MFR" value={rate(summary.mfrRate)} detail="所选期间故障整机数 ÷ 所选期间出货整机数 × 100%。" accent="bg-indigo-600" />
            <Metric label="故障整机" value={number(summary.faultCount)} detail="按 DOA 申报单号中的日期筛选，同一整机每月计一次。" accent="bg-sky-500" />
            <Metric label="期间出货台数" value={number(summary.fleetCount)} detail="按所选起止日期筛选 KK 交付明细发货日期（WADAT），含起止两日，按交付批次去重后汇总 LFIMG 出货数量。" accent="bg-violet-500" />
            <Metric label="未归属设备" value={number(unresolvedDevices)} detail="数据源全量中申报状态或设备身份无法确认的设备，不受当前日期筛选。" accent="bg-amber-500" />
          </div>

          {!!summary.deviceIssues.faultDateUnresolved && <p className="px-4 py-2 text-xs text-amber-800">有 {number(summary.deviceIssues.faultDateUnresolved)} 条换件记录的 DOA 申报日期无效或冲突。</p>}
          {(unresolvedDevices > 0 || summary.unmatchedChangeCount > 0) && <div className="flex items-start gap-2 border-t border-amber-100 bg-amber-50 px-4 py-2 text-xs leading-5 text-amber-800"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /><div><p>数据源中有 {number(unresolvedDevices)} 台设备无法确认申报、订单或身份，未参与统计（不受日期和机型筛选）；所选设备关联服务单中有 {number(summary.unmatchedChangeCount)} 条换件记录无法唯一匹配设备，未计入故障整机。</p>{unresolvedDevices > 0 && <details className="mt-1"><summary className="cursor-pointer font-semibold">查看未归属原因</summary><p className="mt-1">{Object.entries(summary.deviceIssues).filter(([key, value]) => key !== 'lifecycleDateIncomplete' && key !== 'faultDateUnresolved' && value > 0).map(([key, value]) => `${deviceIssueLabels[key] || key}：${number(value)} 台`).join(' · ')}</p></details>}</div></div>}
        </section>

        <section className="min-w-0">
          <div className="min-w-0 border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 sm:px-4">
              <div className="flex items-center gap-1"><h2 className="flex items-center gap-2 text-sm font-semibold"><BarChart3 className="size-4 text-indigo-700" />现网故障趋势</h2><HelpTooltip label="查看趋势统计方式">{dailyTrend ? '按申报单号中的故障日期展示，每台整机计入当月首次有效故障所在日。' : '按申报单号中的故障日期归月，同一整机每月计一次。'}</HelpTooltip></div>
              <div className="flex gap-3 text-xs text-slate-500"><span><span className="mr-1 inline-block size-2 rounded-sm bg-indigo-500" />故障整机</span>{showMfrTrend && <span><span className="mr-1 inline-block size-2 rounded-full bg-amber-700" />MFR</span>}</div>
            </div>
            <div className="h-[250px] px-1 pb-2 pt-3 sm:px-3">{chartTrend.length ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartTrend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="period" tickFormatter={dailyTrend ? (value: string) => value.slice(5) : undefined} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="events" allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
              {showMfrTrend && <YAxis yAxisId="rate" orientation="right" tickFormatter={(value: number) => `${value}%`} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />}
              <Tooltip formatter={(value, name) => [name === 'MFR' ? rate(typeof value === 'number' ? value : null) : number(Number(value)), name]} />
              <Bar yAxisId="events" dataKey="faultCount" name="故障整机" fill="#6366f1" radius={[2, 2, 0, 0]} maxBarSize={32} />
              {showMfrTrend && <Line yAxisId="rate" dataKey="mfrRate" name="MFR" type="monotone" stroke="#b45309" strokeWidth={2} dot={{ r: 3, fill: '#b45309' }} connectNulls={false} />}
            </ComposedChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center text-sm text-slate-400">暂无趋势数据</div>}</div>
          </div>
        </section>

        <section className="border border-slate-200 bg-white">
          <div className="flex min-h-11 flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-3 sm:px-4"><div className="flex items-center gap-1"><h2 className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="size-4 text-indigo-700" />周期明细</h2><HelpTooltip label="查看周期明细说明">{data.trend.length} 个统计月。</HelpTooltip></div><button type="button" onClick={() => void exportCurrent()} disabled={exporting} className="flex h-8 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-xs font-medium text-slate-700 hover:bg-indigo-50 disabled:opacity-60"><Download className="size-4" />{exporting ? '正在导出…' : '导出统计数据'}</button></div>
          {exportError && <p role="alert" className="px-4 py-2 text-sm text-red-700">{exportError}</p>}
          <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-4 py-2">统计月份</th><th className="px-4 py-2 text-right">故障整机</th><th className="px-4 py-2 text-right">累计出货台数</th><th className="px-4 py-2 text-right">MFR</th></tr></thead><tbody className="divide-y divide-slate-100">{data.trend.map(item => <tr key={item.period} className="hover:bg-indigo-50/40"><td className="px-4 py-2 font-mono">{item.period}</td><td className="px-4 py-2 text-right font-mono">{number(item.faultCount)}</td><td className="px-4 py-2 text-right font-mono">{number(item.fleetCount)}</td><td className="px-4 py-2 text-right font-mono font-semibold text-indigo-700">{rate(item.mfrRate)}</td></tr>)}{!data.trend.length && <tr><td colSpan={4} className="px-4 py-12 text-center text-slate-400">暂无周期数据</td></tr>}</tbody></table></div>
        </section>

      </>}
    </main>
  </div>;
}
