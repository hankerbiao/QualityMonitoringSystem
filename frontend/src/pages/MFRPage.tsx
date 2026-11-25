import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, BarChart3, Bell, CalendarDays, Download, Home, RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import { Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import * as XLSX from 'xlsx';
import { mfrApi } from '../api/mfrApi';
import { DashboardSwitcher } from '../components/shared/DashboardSwitcher';
import { DashboardLoading } from '../components/shared/DashboardLoading';
import { DateRangePicker } from '../components/shared/DateRangePicker';
import { MultiSelect } from '../components/shared/MultiSelect';
import { HelpTooltip } from '../components/shared/HelpTooltip';
import type { MFRDashboard, MFRExport, MFRFaultDetail, MFRFilters } from '../types/mfr';
import MFRDetailDialog, { type MFRDetailSelection } from './MFRDetailDialog';
import { formatLocalDate } from '../utils/dateRange';

const number = (value: number | null) => value == null ? "—" : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
const rate = (value: number | null) => value == null ? '—' : `${value.toFixed(2)}%`;
const faultColor = '#6366f1';
const deviceIssueLabels: Record<string, string> = {
  doaStatusUnresolved: 'DOA 申报状态无法确认',
  identityUnverified: '设备身份无法确认',
  identityConflict: '设备身份冲突',
  faultDateUnresolved: 'DOA 申报日期无效或冲突',
  unmatchedChange: '换件记录无法唯一匹配设备',
};
const sameFilters = (a: MFRFilters, b: MFRFilters) =>
  a.dateFrom === b.dateFrom && a.dateTo === b.dateTo && (a.model || '') === (b.model || '');

const warrantyRule = '按 3 年保修估算。每月在保台数为截至该月的最近 36 个自然月出货量，含当月。结束月的出货只计至所选结束日。';
const monthlyMfrRule = '月度 MFR = 所选日期内当月故障整机数 ÷ 当月在保台数 × 100%。';
const overallMfrRule = '综合 MFR = 所选期间故障整机总数 ÷ 各月在保台数之和 × 100%。';

function exportStatistics(data: MFRExport, filters: MFRFilters) {
  const workbook = XLSX.utils.book_new();
  const overview = [
    { 指标: '统计开始日期', 数值: filters.dateFrom },
    { 指标: '统计结束日期', 数值: filters.dateTo },
    { 指标: '机型', 数值: filters.model || '全部机型' },
    { 指标: '统计所需出货中未归属机型的台数', 数值: data.summary.shipmentUnknownModelCount ?? 0 },
    { 指标: '综合 MFR（%）', 数值: data.summary.mfrRate },
    { 指标: '故障整机', 数值: data.summary.faultCount },
    { 指标: '期末在保台数', 数值: data.summary.fleetCount },
    { 指标: '在保统计口径', 数值: warrantyRule },
    { 指标: '月度 MFR 口径', 数值: monthlyMfrRule },
    { 指标: '综合 MFR 口径', 数值: overallMfrRule },
    { 指标: '未能归属设备（全量）', 数值: Object.entries(data.summary.deviceIssues).filter(([key]) => key !== 'lifecycleDateIncomplete' && key !== 'faultDateUnresolved').reduce((sum, [, value]) => sum + value, 0) },
    { 指标: '所选设备日期缺失或冲突', 数值: data.summary.deviceIssues.lifecycleDateIncomplete ?? 0 },
    { 指标: '关联不明确的换件记录', 数值: data.summary.unmatchedChangeCount },
    { 指标: '故障统计口径', 数值: '按 DOA 申报单号中的日期统计，同一整机每个自然月计一次' },
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(overview), '质量概览');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.trend.map(item => ({
    统计月份: item.period, 故障整机: item.faultCount, 在保台数: item.fleetCount, 'MFR（%）': item.mfrRate,
  }))), '月度明细');
  XLSX.utils.book_append_sheet(workbook, faultSheet(data.faultDetails), '故障明细');
  XLSX.writeFile(workbook, `MFR统计_${filters.dateFrom}_${filters.dateTo}.xlsx`);
}

function faultSheet(details: MFRFaultDetail[], includeDeviceKey = false) {
  const headers = ['机型', '故障日期', 'DOA申报单号', '发货日期', '生产订单号', '设备SN', '服务单号', '换件记录ID', '换件类型', '换件时间', '物料编码', '部件SN', '部件名称', '客户'];
  if (includeDeviceKey) headers.push('设备标识');
  const rows = details.map(item => [item.model, item.faultDate, item.doaCode, item.shipmentDate, item.productionOrder,
    item.deviceSn, item.serviceOrder, item.changeId, item.changeType, item.occurredAt,
    item.partNumber, item.partSn, item.partName, item.customer, ...(includeDeviceKey ? [item.deviceKey ?? ''] : [])]);
  return XLSX.utils.aoa_to_sheet([headers, ...rows]);
}

function exportFaults(details: MFRFaultDetail[], period: string, filters: MFRFilters) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, faultSheet(details, Boolean(period)), '故障明细');
  const scope = period ? `${period}_筛选结果_` : '';
  XLSX.writeFile(workbook, `MFR故障明细_${scope}${filters.dateFrom}_${filters.dateTo}.xlsx`);
}

function exportIssues(data: MFRExport) {
  const { dateFrom, dateTo } = data.filters;
  const workbook = XLSX.utils.book_new();
  const devices = data.deviceIssueDetails.map(row => [
    deviceIssueLabels[row.reason] ?? row.reason, row.deviceKey, row.deviceSn,
    row.identityBasis, row.doaCodes.join('、'), row.salesOrders.join('、'),
    row.serviceOrders.join('、'), row.declarationStates.join('；'),
  ]);
  const changes = data.changeIssueDetails.map(row => [
    deviceIssueLabels[row.reason] ?? row.reason, row.changeId, row.serviceOrder, row.doaCodes.join('、'),
    row.deviceKey, row.deviceSn, row.changeDeviceSn, row.changeType, row.occurredAt, row.partNumber, row.partSn,
  ]);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['统计开始日期', dateFrom],
    ['统计结束日期', dateTo],
    ['未归属设备（源数据全量）', devices.length],
    ['换件排查明细', changes.length],
  ]), '排查概览');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['原因', '设备标识', '设备 SN', '身份依据', 'DOA 申报单号', '销售订单号', '服务单号', '申报判定与状态'],
    ...devices,
  ]), '未归属设备');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['原因', '换件记录 ID', '服务单号', 'DOA 申报单号', '设备标识', '整机 SN', '换件记录 SN', '换件类型', '换件时间', '物料编码', '部件 SN'],
    ...changes,
  ]), '换件排查明细');
  XLSX.writeFile(workbook, `MFR排查明细_${dateFrom}_${dateTo}.xlsx`);
}

function Metric({ label, value, detail, accent, children }: {
  label: string; value: string; detail: string; accent: string; children?: React.ReactNode;
}) {
  return <div className="min-w-0 px-3 py-2 sm:px-4">
    <div className="flex items-center gap-1"><span className={`size-2 rounded-full ${accent}`} /><p className="text-xs font-semibold text-slate-600">{label}</p><HelpTooltip label={`查看${label}说明`}>{detail}</HelpTooltip></div>
    <p className="mt-1 font-mono text-xl font-semibold tabular-nums text-slate-950 sm:text-2xl">{value}</p>
    {children}
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
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState<'statistics' | 'issues' | 'faults' | null>(null);
  const [exportError, setExportError] = useState('');
  const [issueExportError, setIssueExportError] = useState('');
  const [trendExportError, setTrendExportError] = useState('');
  const [detail, setDetail] = useState<MFRDetailSelection | null>(null);
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
      setModelOptions(result.modelOptions ?? []);
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
    setTrendExportError('');
    setDraft(next);
    setFilters(next);
    void load(next);
  };
  const summary = data?.summary;
  const deviceIssues = Object.entries(summary?.deviceIssues ?? {})
    .filter(([key, value]) => key !== 'lifecycleDateIncomplete' && key !== 'faultDateUnresolved' && value > 0);
  const unresolvedDevices = deviceIssues.reduce((total, [, value]) => total + value, 0);
  const unresolvedDates = summary?.deviceIssues.faultDateUnresolved ?? 0;
  const unmatchedChanges = summary?.unmatchedChangeCount ?? 0;
  const hasIssues = unresolvedDevices > 0 || unresolvedDates > 0 || unmatchedChanges > 0;
  const hasWarrantyDenominator = data?.trend.some(item => (item.fleetCount ?? 0) > 0);
  const mfrUnavailable = summary?.mfrRate == null
    ? summary?.fleetCount == null ? '在保台数暂不可用'
      : hasWarrantyDenominator ? 'MFR 暂不可用' : '在保窗口内无出货'
    : '';
  const pending = !sameFilters(draft, filters);
  const dailyTrend = filters.dateFrom.slice(0, 7) === filters.dateTo.slice(0, 7) && Boolean(data?.dailyTrend?.length);
  const chartTrend = dailyTrend ? data?.dailyTrend ?? [] : data?.trend ?? [];
  const faultDays = dailyTrend ? chartTrend.filter(item => item.faultCount > 0) : [];
  const exportCurrent = async (mode: 'statistics' | 'issues' | 'faults') => {
    setExporting(mode);
    const setDownloadError = mode === 'issues' ? setIssueExportError : setExportError;
    setDownloadError('');
    try {
      const result = await mfrApi.getExport(filters);
      if (mode === 'issues') exportIssues(result);
      else if (mode === 'faults') exportFaults(result.faultDetails, '', result.filters);
      else exportStatistics(result, result.filters);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExporting(null);
    }
  };

  const exportTrend = () => {
    if (!data || !chartTrend.length) return;
    setTrendExportError('');
    try {
      const rows = dailyTrend
        ? data.dailyTrend.map(item => ({ 故障日期: item.period, 故障整机: item.faultCount }))
        : data.trend.map(item => ({ 统计月份: item.period, 故障整机: item.faultCount }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), dailyTrend ? '按日趋势' : '按月趋势');
      XLSX.writeFile(workbook, `MFR趋势_${dailyTrend ? '按日' : '按月'}_${filters.dateFrom}_${filters.dateTo}.xlsx`);
    } catch (err) {
      setTrendExportError(err instanceof Error ? err.message : '趋势导出失败');
    }
  };

  return <div className="min-h-screen bg-[#f4f6f5] text-slate-800">
    <header className="border-b border-slate-200 bg-white">
      <div className="relative mx-auto flex min-h-14 max-w-[1600px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Link to="/" className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700" aria-label="返回首页" title="返回首页"><Home className="size-4" />返回首页</Link>
          <div className="min-w-0"><div className="flex items-center gap-1"><h1 className="truncate text-lg font-semibold text-slate-950">MFR 现网质量看板</h1><HelpTooltip label="查看 MFR 看板说明">按 SCS 销售订单号的 XNC 前缀判定 5000 公司归属，按 DOA 申报单号中的日期统计故障整机。</HelpTooltip></div><p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-600"><Activity className="size-3 text-indigo-600" />DOA 申报日期</p></div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {hasIssues && <details key={`${filters.dateFrom}:${filters.dateTo}`} className="sm:relative">
            <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 text-xs font-medium text-amber-900 focus-visible:outline-2 focus-visible:outline-indigo-600 [&::-webkit-details-marker]:hidden">
              <Bell className="size-4" aria-hidden="true" /> 数据告警
            </summary>
            <section aria-label="数据告警详情" className="absolute right-3 z-30 mt-2 w-[min(18rem,calc(100vw-1.5rem))] sm:right-0 rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-lg sm:w-96">
              <ul className="space-y-2 text-slate-700">
                {unresolvedDates > 0 && <li><strong>{number(unresolvedDates)} 条</strong>换件记录的 DOA 申报日期无效或冲突，已排除。</li>}
                {unresolvedDevices > 0 && <li>
                  <strong>{number(unresolvedDevices)} 台</strong>设备无法确认申报状态或身份，未参与统计（不受日期筛选）。
                  <ul className="mt-1 space-y-1 rounded bg-slate-50 p-2">
                    {deviceIssues.map(([key, count]) => <li key={key} className="flex items-center justify-between gap-2"><span>{deviceIssueLabels[key] ?? key}</span><span className="shrink-0 font-mono">{number(count)} 台</span></li>)}
                  </ul>
                </li>}
                {unmatchedChanges > 0 && <li><strong>{number(unmatchedChanges)} 条</strong>换件记录无法唯一匹配设备，未计入故障整机。</li>}
              </ul>
              <button type="button" onClick={() => void exportCurrent('issues')} disabled={exporting !== null} className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-indigo-700 px-3 text-white hover:bg-indigo-800 disabled:opacity-50">
                <Download className="size-4" aria-hidden="true" />{exporting === 'issues' ? '正在导出…' : '导出排查明细'}
              </button>
              {issueExportError && <p role="alert" className="mt-2 text-red-700">{issueExportError}</p>}
            </section>
          </details>}
          <DashboardSwitcher />
        </div>
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
          <div className="w-full sm:w-56">
            <MultiSelect label="机型" options={modelOptions} value={draft.model ? [draft.model] : []}
              onChange={([model]) => setDraft(current => ({ ...current, model: model || '' }))} single />
          </div>
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
            <p>{monthlyMfrRule}</p>
            <p className="mt-1">{warrantyRule}</p>
            <p className="mt-1">故障日期取自 DOA 申报单号，同一整机每个自然月计一次。</p>

          </HelpTooltip></div><span className="text-xs text-slate-500">{filters.dateFrom} 至 {filters.dateTo} · {filters.model || '全部机型'}</span></div>
          <div className="grid grid-cols-2 divide-x divide-y divide-slate-200 lg:grid-cols-4 lg:divide-y-0">
            <Metric label="综合 MFR" value={rate(summary.mfrRate)} detail={overallMfrRule} accent="bg-indigo-600">
              {mfrUnavailable && <p className="mt-1 text-xs text-slate-600">{mfrUnavailable}</p>}
              {filters.model && filters.model !== '未知机型' && (summary.shipmentUnknownModelCount ?? 0) > 0 &&
                <p className="mt-1 text-xs text-amber-800">按已归属机型的出货估算，同期另有 {number(summary.shipmentUnknownModelCount ?? 0)} 台出货机型待确认。</p>}
              {unresolvedDates > 0 && <button type="button" onClick={() => setDetail('date-issues')}
                className="mt-1 text-xs font-medium text-indigo-700 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-indigo-600">
                查看日期异常（已排除 {number(unresolvedDates)} 条）
              </button>}
            </Metric>
            <Metric label="故障整机" value={number(summary.faultCount)} detail="按 DOA 申报单号中的日期筛选，同一整机每月计一次。" accent="bg-sky-500" />
            <Metric label="期末在保台数" value={number(summary.fleetCount)} detail={`${warrantyRule} 出货量按 KK 交付批次去重后汇总 LFIMG 出货数量。`} accent="bg-violet-500" />
            <Metric label="未归属设备" value={number(unresolvedDevices)} detail="数据源全量中申报状态或设备身份无法确认的设备，不受当前日期筛选。" accent="bg-amber-500" />
          </div>

        </section>

        <section aria-labelledby="mfr-trend" className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-4 sm:px-5">
            <div className="flex items-center gap-1">
              <h2 id="mfr-trend" className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <BarChart3 aria-hidden="true" className="size-4 text-blue-600" />现网故障趋势
              </h2>
              <HelpTooltip label="查看趋势统计方式">
                {dailyTrend
                  ? '按申报单号中的故障日期展示，每台整机计入当月首次有效故障所在日。'
                  : '故障按申报单号中的日期归月，同一整机每月计一次。'}
              </HelpTooltip>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={exportTrend} disabled={!chartTrend.length} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-xs font-medium hover:bg-indigo-50 disabled:opacity-60">
                <Download className="size-4" aria-hidden="true" />导出趋势
              </button>
            </div>
          </div>
          {trendExportError && <p role="alert" className="px-4 py-2 text-sm text-red-700">{trendExportError}</p>}
          {chartTrend.length ? <>
            <div className="h-[244px] px-2 pt-3 sm:h-[300px] sm:px-4">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartTrend} accessibilityLayer margin={{ top: 24, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="period" tickFormatter={dailyTrend ? (value: string) => value.slice(5) : undefined}
                    tick={{ fontSize: 11, fill: '#475569' }} tickLine={false} axisLine={false} minTickGap={16} />
                  <YAxis width={40} tickCount={4} domain={[0, 'auto']} allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#475569' }} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ fill: '#f1f5f9' }} content={({ active, label }) => {
                    const point = chartTrend.find(item => item.period === label);
                    if (!active || !point) return null;
                    return <div role="status" className="rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-md">
                      <p className="mb-2 font-semibold text-slate-900">{point.period}</p>
                      <p className="text-indigo-800">故障整机 <strong>{number(point.faultCount)} 台</strong></p>
                      {point.faultCount > 0 && <p className="mt-2 text-slate-600">点击故障柱查看明细</p>}
                    </div>;
                  }} />
                  <Bar dataKey="faultCount" name="故障整机" fill={faultColor}
                    radius={[5, 5, 0, 0]} maxBarSize={40} isAnimationActive={false}
                    className="cursor-pointer"
                    onClick={(_, index) => {
                      const point = chartTrend[index];
                      if (point?.faultCount) setDetail({ period: point.period });
                    }}
                    label={{ position: 'top', fill: '#3730a3', fontSize: 11, fontWeight: 600,
                      formatter: value => typeof value === 'number' && (!dailyTrend || value !== 0) ? number(value) : '' }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {faultDays.length > 0 && <form className="flex flex-wrap items-center gap-2 px-3 pb-3 sm:px-4" onSubmit={event => {
              event.preventDefault();
              const period = new FormData(event.currentTarget).get('period');
              if (typeof period === 'string' && period) setDetail({ period });
            }}>
              <select name="period" aria-label="查看单日故障明细" required defaultValue=""
                className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700 focus-visible:outline-2 focus-visible:outline-indigo-600">
                <option value="" disabled>选择故障日期</option>
                {faultDays.map(item => <option key={item.period} value={item.period}>{item.period} · {number(item.faultCount)} 台</option>)}
              </select>
              <button type="submit" className="inline-flex h-8 items-center rounded-md border border-slate-300 px-3 text-xs font-medium text-indigo-700 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-indigo-600">
                查看单日故障
              </button>
            </form>}
          </> : <div className="flex h-44 items-center justify-center text-sm text-slate-500">暂无趋势数据</div>}
        </section>

        <section className="border border-slate-200 bg-white">
          <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 sm:px-4">
            <div className="flex items-center gap-1"><h2 className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="size-4 text-indigo-700" />周期明细</h2><HelpTooltip label="查看周期明细说明">{data.trend.length} 个统计月。</HelpTooltip></div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void exportCurrent('faults')} disabled={exporting !== null} className="flex h-8 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-xs font-medium text-slate-700 hover:bg-indigo-50 disabled:opacity-60">
                <Download className="size-4" aria-hidden="true" />{exporting === 'faults' ? '正在导出故障明细…' : '导出故障明细'}
              </button>
              <button type="button" onClick={() => void exportCurrent('statistics')} disabled={exporting !== null} className="flex h-8 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-xs font-medium text-slate-700 hover:bg-indigo-50 disabled:opacity-60">
                <Download className="size-4" aria-hidden="true" />{exporting === 'statistics' ? '正在导出…' : '导出统计数据'}
              </button>
            </div>
          </div>
          {exportError && <p role="alert" className="px-4 py-2 text-sm text-red-700">{exportError}</p>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600"><tr>
                <th scope="col" className="px-4 py-2">统计月份</th>
                <th scope="col" className="px-4 py-2 text-right">故障整机</th>
                <th scope="col" className="px-4 py-2 text-right">在保台数</th>
                <th scope="col" className="px-4 py-2 text-right">MFR</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.trend.map(item => <tr key={item.period} className="hover:bg-indigo-50/40">
                  <td className="px-4 py-2 font-mono">{item.period}</td>
                  <td className="px-4 py-2 text-right font-mono">
                    {item.faultCount > 0 ? <button type="button" aria-label={`查看 ${item.period} 故障明细`}
                      onClick={() => setDetail({ period: item.period })}
                      className="rounded-sm font-semibold text-indigo-700 underline underline-offset-2 hover:text-indigo-900 focus-visible:outline-2 focus-visible:outline-indigo-600">
                      {number(item.faultCount)}
                    </button> : number(item.faultCount)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">{number(item.fleetCount)}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold text-indigo-700">{rate(item.mfrRate)}</td>
                </tr>)}
                {!data.trend.length && <tr><td colSpan={4} className="px-4 py-12 text-center text-slate-400">暂无周期数据</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

      </>}
    </main>
    {detail && <MFRDetailDialog filters={filters} selection={detail} onClose={() => setDetail(null)} onExportFaults={exportFaults} />}
  </div>;
}
