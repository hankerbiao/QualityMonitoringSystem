import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, ArrowLeft, ChevronDown, ChevronRight, Download, RotateCcw, Search, Wrench, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Bar, CartesianGrid, Cell, ComposedChart, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import * as XLSX from 'xlsx';
import { reinsertApi, type DetailKind, type DetailQuery, type DetailResult, type ReinsertBase, type ReinsertCell, type ReinsertDashboard, type ReinsertQuery } from '../api/reinsertApi';
import { DashboardSwitcher } from '../components/shared/DashboardSwitcher';
import { HelpTooltip } from '../components/shared/HelpTooltip';
import { DateRangePicker } from '../components/shared/DateRangePicker';
import { MultiSelect } from '../components/shared/MultiSelect';
import { recentDateRange } from '../utils/dateRange';
import { REPAIR_CHART_COLORS } from '../utils/repairQualityCharts';
import { buildReinsertWorkbook } from './reinsertExport';

const colors = ['#0f766e', '#2563eb', '#d97706', '#be185d', '#7c3aed'];
const componentColors = [...colors, '#0891b2', '#65a30d', '#c2410c', '#4f46e5', '#64748b'];
const labels: Record<DetailKind, string> = { reinsert: '重插事件', repairs: '全部维修事件', orders: '计划订单', postings: '发退料记录', invalid: '缺少SN或NG工站的记录' };
const number = (value: number | null) => value == null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const rate = (value: number | null) => value == null ? '—' : `${value.toFixed(2)}%`;

function initialQuery(): ReinsertQuery {
  const { from, to } = recentDateRange(7);
  return { dateFrom: from, dateTo: to };
}

export default function ReinsertRatePage() {
  const navigate = useNavigate();
  const [initial] = useState(initialQuery);
  const [draft, setDraft] = useState(initial);
  const [applied, setApplied] = useState(initial);
  const [data, setData] = useState<ReinsertDashboard | null>(null);
  const [options, setOptions] = useState({ productModels: [] as string[], customers: [] as string[], bases: [] as string[] });
  const [error, setError] = useState('');
  const [optionsError, setOptionsError] = useState('');
  const [loading, setLoading] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exporting, setExporting] = useState(false);
  const exportInProgress = useRef(false);
  const [detail, setDetail] = useState<DetailQuery | null>(null);
  const [selectedBase, setSelectedBase] = useState<{ model: string; base: string } | null>(null);
  const request = useRef(0);

  const load = useCallback(async (query: ReinsertQuery) => {
    const id = ++request.current;
    setLoading(true); setError(''); setData(null); setDetail(null);
    try {
      const result = await reinsertApi.dashboard(query);
      if (id === request.current) { setData(result); setApplied(query); setSelectedBase(null); }
    } catch (reason) {
      if (id === request.current) setError(reason instanceof Error ? reason.message : '重插数据加载失败');
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    reinsertApi.options().then(result => { if (active) setOptions(result); }).catch(reason => {
      if (active) setOptionsError(reason instanceof Error ? reason.message : '筛选项加载失败');
    });
    void load(initial);
    return () => { active = false; request.current += 1; };
  }, [initial, load]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.dateFrom || !draft.dateTo || draft.dateFrom > draft.dateTo) {
      setError('请选择有效的日期范围'); return;
    }
    void load(draft);
  };
  const open = (kind: DetailKind, base = '', month = '', component = '', pn = '', model?: string) =>
    setDetail({ ...applied, kind, base, month, component, pn, model });
  const close = useCallback(() => setDetail(null), []);
  const activeBase = data?.models.find(item => item.model === selectedBase?.model)?.bases.find(base => base.base === selectedBase?.base);
  const exportDashboard = async () => {
    if (!data || exportInProgress.current) return;
    exportInProgress.current = true;
    setExporting(true); setExportError('');
    try {
      const items: Record<string, unknown>[] = [];
      let total = Infinity;
      for (let page = 1; items.length < total; page += 1) {
        const result = await reinsertApi.details({ ...applied, kind: 'faults' }, page, 200);
        if (total !== Infinity && total !== result.total) throw new Error('故障数据已变化，请重新查询');
        total = result.total;
        if ((!result.items.length && items.length < total) || items.length + result.items.length > total) throw new Error('故障明细分页不完整');
        items.push(...result.items);
      }
      const workbook = buildReinsertWorkbook(data, applied);
      const sheet = XLSX.utils.json_to_sheet(items.map(item => flattenRecord(item)));
      XLSX.utils.book_append_sheet(workbook, sheet, '故障明细');
      XLSX.writeFile(workbook, `重插率分析_${applied.dateFrom}_${applied.dateTo}.xlsx`);
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : '导出失败，请重试');
    } finally {
      exportInProgress.current = false;
      setExporting(false);
    }
  };

  return <div className="min-h-screen bg-slate-50 text-slate-800">
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-4 backdrop-blur">
      <div className="mx-auto flex min-h-15 max-w-[1720px] items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <button type="button" onClick={() => navigate('/')} title="返回首页" aria-label="返回首页" className="inline-flex size-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"><ArrowLeft className="size-4" /></button>
          <span className="flex size-8 items-center justify-center rounded-md bg-teal-50 text-teal-700"><Wrench className="size-4" /></span>
          <div className="flex items-center gap-1"><h1 className="text-base font-semibold text-slate-900">重插率分析</h1><HelpTooltip label="查看重插率分析维度">按机型、基地、部件和物料 PN 展示重插表现。</HelpTooltip></div>
        </div>
        <DashboardSwitcher />
      </div>
    </header>
    <main className="mx-auto max-w-[1720px] space-y-4 px-3 py-4 sm:px-5">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2 border-b border-slate-200 pb-4">
        <DateRangePicker label="订单计划日期" from={draft.dateFrom} to={draft.dateTo} onChange={(dateFrom, dateTo) => setDraft(value => ({ ...value, dateFrom, dateTo }))} />
        <MultiSelect label="基地（多选）" options={options.bases} value={draft.bases ?? []} onChange={bases => setDraft(value => ({ ...value, bases }))} />
        <MultiSelect label="客户（多选）" options={options.customers} value={draft.customers ?? []} onChange={customers => setDraft(value => ({ ...value, customers }))} />
        <MultiSelect label="机型（多选）" options={options.productModels} value={draft.productModels ?? []} onChange={productModels => setDraft(value => ({ ...value, productModels }))} />
        <button type="submit" disabled={loading} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-teal-700 px-3 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50"><Search className="size-3.5" />查询</button>
        <button type="button" disabled={loading} onClick={() => { setDraft(initial); void load(initial); }} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-700 hover:bg-slate-50"><RotateCcw className="size-3.5" />重置</button>
        <button type="button" onClick={() => void exportDashboard()} disabled={loading || exporting || !data?.models.length} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"><Download className="size-3.5" />{exporting ? '导出中...' : '导出 Excel'}</button>
      </form>
      {exportError && <p role="alert" className="text-xs text-red-700">导出失败：{exportError}</p>}
      {optionsError && <p role="alert" className="text-xs text-amber-700">筛选项加载失败：{optionsError}</p>}
      {error && <div role="alert" className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error} <button type="button" className="underline" onClick={() => void load(draft)}>重试</button></div>}
      {loading && <div role="status" className="py-16 text-center text-sm text-slate-500">正在汇总订单、维修与发料记录...</div>}
      {data && <>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
          <div><h2 className="text-sm font-semibold">月度重插表现</h2><p className="mt-1 text-xs text-slate-500">{applied.dateFrom} 至 {applied.dateTo} · 订单计划月</p></div>
          {data.invalidCount > 0 && <button type="button" onClick={() => open('invalid')} className="inline-flex items-center gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800 underline decoration-dotted"><AlertTriangle className="size-3.5" />{data.invalidCount} 条记录缺少 SN 或工站（重插 {data.invalidReinsertCount} 条）</button>}
        </div>
        {!data.models.length ? <div className="py-16 text-center text-sm text-slate-500">当前筛选条件下没有订单数据</div>
          : activeBase && selectedBase ? <BaseSection key={JSON.stringify(selectedBase)} model={selectedBase.model} base={activeBase} months={data.months} open={(kind, base, month, component, pn) => open(kind, base, month, component, pn, selectedBase.model)} onBack={() => setSelectedBase(null)} />
            : <><DefectResponsibilityChart items={data.defectResponsibilities ?? []} /><BaseOverview models={data.models} months={data.months} open={open} onSelect={setSelectedBase} /></>}
      </>}
    </main>
    {detail && <DetailDialog query={detail} onClose={close} />}
  </div>;
}

type OpenDetail = (kind: DetailKind, base?: string, month?: string, component?: string, pn?: string, model?: string) => void;

function DefectResponsibilityChart({ items }: { items: ReinsertDashboard['defectResponsibilities'] }) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return <figure className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
    <div className="mx-auto min-w-0 max-w-2xl">
      <figcaption className="flex min-h-11 items-start justify-between gap-2">
        <div className="flex items-center gap-1"><h2 className="text-xs font-semibold text-slate-800">维修故障缺陷责任分类</h2><HelpTooltip label="查看缺陷责任分类说明">按当前筛选条件内的维修故障记录数量统计，包含缺少 SN 或工站的记录。</HelpTooltip></div>
        <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{total.toLocaleString()} 条</span>
      </figcaption>
      {total === 0 ? <p className="py-12 text-center text-sm text-slate-500">当前筛选条件下没有维修故障记录</p> :
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 sm:justify-start">
        <div className="relative h-36 w-36 shrink-0" role="img" aria-label="维修故障缺陷责任分类饼图">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <PieChart>
              <Pie data={items} dataKey="count" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={59} isAnimationActive={false}>{items.map((item, index) => <Cell key={item.name} fill={REPAIR_CHART_COLORS[index % REPAIR_CHART_COLORS.length]} />)}</Pie>
              <Tooltip contentStyle={{ borderRadius: 4, border: '1px solid #cbd5e1', fontSize: 12 }} formatter={value => [`${value} 条`, '故障记录']} />
            </PieChart>
          </ResponsiveContainer>
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-[54px] text-center">
            <p className="text-sm font-semibold leading-5 tabular-nums text-emerald-800">{total.toLocaleString()}</p>
            <p className="mt-0.5 text-[10px] text-slate-500">故障记录</p>
          </div>
        </div>
        <ul className="flex min-w-0 flex-1 basis-48 flex-wrap gap-x-4 gap-y-2 text-[11px] tabular-nums text-slate-600">
          {items.map((item, index) => <li key={item.name} className="inline-flex max-w-full items-center gap-1"><span className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: REPAIR_CHART_COLORS[index % REPAIR_CHART_COLORS.length] }} /><span className="min-w-0 break-words">{item.name}</span><span className="shrink-0 whitespace-nowrap">{item.count.toLocaleString()} 条 · {(item.count / total * 100).toFixed(1)}%</span></li>)}
        </ul>
      </div>}
    </div>
  </figure>;
}

function BaseOverview({ models, months, open, onSelect }: { models: ReinsertDashboard['models']; months: string[]; open: OpenDetail; onSelect: (selection: { model: string; base: string }) => void }) {
  return <section aria-labelledby="base-overview-title">
    <div className="flex flex-wrap items-center justify-between gap-2 py-3">
      <div><h2 id="base-overview-title" className="text-sm font-semibold text-slate-900">机型与基地汇总</h2><p className="mt-1 text-xs text-slate-500">点击基地查看趋势，点击数值查看明细</p></div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500"><span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-amber-500" />有重插记录</span><span className="rounded-full bg-slate-200/70 px-2.5 py-1 font-medium text-slate-600">{models.length} 个机型</span></div>
    </div>
    <div className="overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="w-full table-fixed border-collapse text-right text-xs tabular-nums" style={{ minWidth: 272 + months.length * 400 }}>
        <colgroup><col style={{ width: 160 }} /><col style={{ width: 112 }} />{months.flatMap(month => Array.from({ length: 4 }, (_, index) => <col key={`${month}-${index}`} />))}</colgroup>
        <thead className="bg-slate-50 text-slate-600">
          <tr><th rowSpan={2} className="sticky left-0 z-10 border border-slate-200 bg-slate-50 px-3 py-2.5 text-left">机型</th><th rowSpan={2} className="border border-slate-200 px-3 py-2.5 text-left">基地</th>{months.map(month => <th key={month} colSpan={4} className="border border-slate-200 bg-cyan-50 px-2 py-2.5 text-center font-semibold text-cyan-900">{month}</th>)}</tr>
          <tr>{months.flatMap(month => ['重插数', '维修数', '计划量', '整机重插率'].map(label => <th key={`${month}-${label}`} className={`border border-slate-200 px-2 py-2 ${label === '整机重插率' ? 'bg-cyan-50/50 text-cyan-900' : ''}`}>{label}</th>))}</tr>
        </thead>
        <tbody>{models.flatMap(({ model, bases }) => bases.map((base, index) => <tr key={JSON.stringify([model, base.base])} className="group hover:bg-cyan-50/50">
          {index === 0 && <th scope="rowgroup" rowSpan={bases.length} className="sticky left-0 z-[1] break-words border border-slate-200 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-700">{model || '未填写机型'}</th>}
          <th scope="row" className="border border-slate-200 px-3 py-2 text-left font-medium">
            <button type="button" onClick={() => onSelect({ model, base: base.base })} aria-label={`查看${model || '未填写机型'} ${base.base}基地详情`} className="inline-flex items-center gap-1 rounded-md bg-teal-50 px-2 py-1 text-teal-800 transition-colors hover:bg-teal-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600">
              <ChevronRight className="size-4 shrink-0" />{base.base}
            </button>
          </th>
          {months.flatMap(month => {
            const value = base.months[month];
            const cells: [string, DetailKind, string][] = [
              [number(value.reinsertCount), 'reinsert', '重插数'], [number(value.repairCount), 'repairs', '维修数'],
              [number(value.plannedQuantity), 'orders', '计划量'], [rate(value.plannedRate), 'reinsert', '整机重插率'],
            ];
            return cells.map(([text, kind, title]) => <td key={`${month}-${title}`} className={`border border-slate-200 px-2 py-2 ${title === '整机重插率' ? 'bg-cyan-50/30' : ''}`} title={text === '—' ? '计划量缺失或不大于零' : undefined}>
              {text === '—' ? <span className="text-slate-400">—</span> : <button type="button" aria-label={`${model || '未填写机型'} ${base.base} ${month} ${title}明细`} onClick={() => open(kind, base.base, month, '', '', model)} className={`rounded px-1.5 py-0.5 underline decoration-dotted underline-offset-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ${value.reinsertCount > 0 && (title === '重插数' || title === '整机重插率') ? 'bg-amber-50 font-semibold text-amber-800 hover:bg-amber-100' : 'text-slate-600 hover:bg-cyan-100 hover:text-cyan-800'}`}>{text}</button>}
            </td>);
          })}
        </tr>))}</tbody>
      </table>
    </div>
  </section>;
}

function ChartSeriesSelector({ label, items, hidden, setHidden }: { label: string; items: { id: string; label: string; color: string }[]; hidden: Set<string>; setHidden: React.Dispatch<React.SetStateAction<Set<string>>> }) {
  if (!items.length) return null;
  return <fieldset className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
    <legend className="mb-1 text-slate-500">{label}</legend>
    {items.map(item => <label key={item.id} className="inline-flex cursor-pointer items-center gap-1.5">
      <input type="checkbox" checked={!hidden.has(item.id)} onChange={() => setHidden(current => {
        const next = new Set(current);
        if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
        return next;
      })} className="accent-teal-700" />
      <span aria-hidden="true" className="size-2.5 rounded-full" style={{ backgroundColor: item.color }} />{item.label}
    </label>)}
  </fieldset>;
}

function BaseSection({ model, base, months, open, onBack }: { model: string; base: ReinsertBase; months: string[]; open: OpenDetail; onBack: () => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [hiddenMetrics, setHiddenMetrics] = useState<Set<string>>(new Set());
  const [hiddenPns, setHiddenPns] = useState<Set<string>>(new Set());
  const [hiddenComponents, setHiddenComponents] = useState<Set<string>>(new Set());
  const daily = months.length === 1 && !!base.days;
  const periods = daily ? Object.keys(base.days!) : months;
  const chart = periods.map(period => ({ period, count: (daily ? base.days![period] : base.months[period]).reinsertCount, rate: (daily ? base.days![period] : base.months[period]).plannedRate }));
  const pnChart = periods.map(period => Object.fromEntries([['period', period], ...base.topPns.map((item, index) => [`pn${index}`, (daily ? item.days?.[period] : item.months[period])?.plannedRate ?? null])]));
  const componentChart = periods.map(period => Object.fromEntries([['period', period], ...base.components.map((item, index) => [`component${index}`, daily ? item.dailyReinsertCounts?.[period] ?? null : item.months[period]?.reinsertCount ?? null])]));
  const toggle = (component: string) => setExpanded(current => {
    const next = new Set(current);
    if (next.has(component)) next.delete(component); else next.add(component);
    return next;
  });
  return <section className="border-b border-slate-300 pb-5">
    <div className="flex flex-wrap items-center gap-3 py-2">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-xs text-teal-700 hover:underline"><ArrowLeft className="size-3.5" />机型与基地汇总</button>
      <span className="h-4 w-px bg-slate-300" />
      <h2 className="text-sm font-semibold text-slate-900">{model || '未填写机型'} / {base.base}</h2>
    </div>
    <div className="grid min-w-0 grid-cols-1 gap-4 py-2 xl:grid-cols-2">
      <figure className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><figcaption className="mb-4 flex items-center gap-1 text-sm font-semibold text-slate-800">{daily ? '每日' : '月度'}重插数与整机口径重插率<HelpTooltip label="查看整机口径重插率说明">按订单计划{daily ? '日' : '月'}展示重插数量与整机计划量口径的重插率。</HelpTooltip></figcaption>
        <div className="h-56" role="img" aria-label={`${base.base}${daily ? '每日' : '月度'}重插数与重插率`}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0}><ComposedChart data={chart} margin={{ top: 8, left: 0, right: 5 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} /><XAxis dataKey="period" tickFormatter={value => daily ? value.slice(5) : value} axisLine={false} tickLine={false} tickMargin={10} tick={{ fontSize: 11, fill: '#64748b' }} /><YAxis yAxisId="count" allowDecimals={false} width={38} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} /><YAxis yAxisId="rate" orientation="right" width={48} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={v => `${v}%`} /><Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)', fontSize: 12 }} formatter={(value, name) => name === '重插率' ? [`${value}%`, name] : [value, name]} />{!hiddenMetrics.has('count') && <Bar yAxisId="count" dataKey="count" name="重插数" fill="#0f766e" radius={[6, 6, 0, 0]} maxBarSize={28} isAnimationActive={false} />}{!hiddenMetrics.has('rate') && <Line yAxisId="rate" type="monotone" dataKey="rate" name="重插率" stroke="#d97706" strokeWidth={2.5} strokeLinecap="round" dot={{ r: 4, fill: '#fff', strokeWidth: 2 }} activeDot={{ r: 6 }} connectNulls={false} isAnimationActive={false} />}
          </ComposedChart></ResponsiveContainer>
        </div>
        <ChartSeriesSelector label="选择重插指标" items={[{ id: 'count', label: '重插数', color: '#0f766e' }, { id: 'rate', label: '整机重插率', color: '#d97706' }]} hidden={hiddenMetrics} setHidden={setHiddenMetrics} />
      </figure>
      <figure className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><figcaption className="mb-4 flex items-center gap-1 text-sm font-semibold text-slate-800">PN Top 5 {daily ? '每日' : '月度'}重插率<HelpTooltip label="查看 PN 重插率说明">按订单计划{daily ? '日' : '月'}展示基地内重插数量排名前五的 PN 的整机口径重插率。</HelpTooltip></figcaption>
        <div className="h-56" role="img" aria-label={`${base.base} PN前五${daily ? '每日' : '月度'}重插率`}>
          {base.topPns.length ? <ResponsiveContainer width="100%" height="100%" minWidth={0}><LineChart data={pnChart} margin={{ top: 8, left: 0, right: 8 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} /><XAxis dataKey="period" tickFormatter={value => daily ? value.slice(5) : value} axisLine={false} tickLine={false} tickMargin={10} tick={{ fontSize: 11, fill: '#64748b' }} /><YAxis width={48} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={v => `${v}%`} /><Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)', fontSize: 12 }} formatter={(value, name) => [`${value}%`, name]} />{base.topPns.map((item, index) => !hiddenPns.has(item.pn) && <Line key={item.pn} type="monotone" dataKey={`pn${index}`} name={item.pn} stroke={colors[index]} strokeWidth={2.5} strokeLinecap="round" dot={{ r: 4, fill: '#fff', strokeWidth: 2 }} activeDot={{ r: 6 }} connectNulls={false} isAnimationActive={false} />)}
          </LineChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center text-xs text-slate-400">暂无 PN 数据</div>}
        </div>
        <ChartSeriesSelector label="选择 PN" items={base.topPns.map((item, index) => ({ id: item.pn, label: item.pn, color: colors[index] }))} hidden={hiddenPns} setHidden={setHiddenPns} />
      </figure>
    </div>
    <figure className="mt-2 min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <figcaption className="mb-1 flex items-center gap-1 text-sm font-semibold text-slate-800">部件{daily ? '每日' : '月度'}重插数趋势<HelpTooltip label="查看部件趋势说明">按订单计划{daily ? '日' : '月'}展示当前机型和基地各部件的重插事件数。</HelpTooltip></figcaption>
      <p className="mb-3 text-xs text-slate-500">按订单计划{daily ? '日' : '月'} · 单位：重插事件</p>
      {base.components.length ? <>
        <div className="h-56" role="img" aria-label={`${base.base}部件${daily ? '每日' : '月度'}重插数趋势`}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0}><LineChart data={componentChart} margin={{ top: 8, left: 0, right: 8 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="period" tickFormatter={value => daily ? value.slice(5) : value} axisLine={false} tickLine={false} tickMargin={10} tick={{ fontSize: 11, fill: '#64748b' }} />
            <YAxis allowDecimals={false} width={38} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
            <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} formatter={(value, name) => [`${value} 次`, name]} />
            {base.components.map((item, index) => !hiddenComponents.has(item.component) && <Line key={item.component} type="linear" dataKey={`component${index}`} name={item.component} stroke={componentColors[index % componentColors.length]} strokeDasharray={index >= componentColors.length ? '5 3' : undefined} strokeWidth={2} dot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />)}
          </LineChart></ResponsiveContainer>
        </div>
        <ChartSeriesSelector label="选择部件" items={base.components.map((item, index) => ({ id: item.component, label: item.component, color: componentColors[index % componentColors.length] }))} hidden={hiddenComponents} setHidden={setHiddenComponents} />
      </> : <div className="flex h-40 items-center justify-center text-xs text-slate-400">暂无部件数据</div>}
    </figure>
    <div className="mt-4 overflow-auto border border-slate-300 bg-white">
      <table className="w-full min-w-max border-collapse text-right text-xs tabular-nums">
        <thead className="bg-slate-100 text-slate-700"><tr><th rowSpan={2} className="sticky left-0 z-10 min-w-44 border border-slate-300 bg-slate-100 px-3 py-2 text-left">部件 / PN</th>{months.map(month => <th key={month} colSpan={6} className="border border-slate-300 px-2 py-2 text-center">{month}</th>)}</tr>
          <tr>{months.flatMap(month => ['重插数', '维修数', '计划量', '整机重插率', 'PN净发料', 'PN使用重插率'].map(label => <th key={`${month}-${label}`} className="border border-slate-300 px-2 py-1.5">{label}</th>))}</tr></thead>
        <tbody>
          <TableRow label="基地汇总" base={base.base} months={months} values={base.months} open={open} />
          {base.components.map(group => <FragmentGroup key={group.component} group={group} base={base.base} months={months} expanded={expanded.has(group.component)} toggle={() => toggle(group.component)} open={open} />)}
        </tbody>
      </table>
    </div>
  </section>;
}

function FragmentGroup({ group, base, months, expanded, toggle, open }: { group: ReinsertBase['components'][number]; base: string; months: string[]; expanded: boolean; toggle: () => void; open: (kind: DetailKind, base?: string, month?: string, component?: string, pn?: string) => void }) {
  return <><TableRow label={group.component} base={base} months={months} values={group.months} component={group.component} expanded={expanded} toggle={toggle} open={open} />
    {expanded && group.pns.map(item => <TableRow key={item.pn} label={item.pn} base={base} months={months} values={item.months} component={group.component} pn={item.pn} open={open} />)}</>;
}

function TableRow({ label, base, months, values, component = '', pn = '', expanded, toggle, open }: { label: string; base: string; months: string[]; values: Record<string, ReinsertCell>; component?: string; pn?: string; expanded?: boolean; toggle?: () => void; open: (kind: DetailKind, base?: string, month?: string, component?: string, pn?: string) => void }) {
  return <tr className="hover:bg-teal-50/40">
    <th className="sticky left-0 z-[1] border border-slate-200 bg-white px-3 py-2 text-left font-medium">
      {toggle ? <button type="button" onClick={toggle} aria-expanded={expanded} className="inline-flex items-center gap-1 text-teal-800">{expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}{label}</button> : <span className={pn ? 'pl-5' : 'font-semibold'}>{label}</span>}
    </th>
    {months.flatMap(month => {
      const value = values[month];
      const cells: [string, DetailKind, string][] = [
        [number(value.reinsertCount), 'reinsert', '重插数'], [number(value.repairCount), 'repairs', '维修数'],
        [number(value.plannedQuantity), 'orders', '计划量'], [rate(value.plannedRate), 'reinsert', '整机重插率'],
        [pn ? number(value.usageQuantity) : '—', 'postings', 'PN净发料'], [pn ? rate(value.usageRate) : '—', 'reinsert', 'PN使用重插率'],
      ];
      return cells.map(([text, kind, title]) => <td key={`${month}-${title}`} className="border border-slate-200 px-2 py-2" title={title.includes('PN') ? value.usageReason || undefined : text === '—' ? '无关联订单、计划量缺失或计划量不大于零' : undefined}>
        {text === '—' ? <span className="text-slate-400">—</span> : <button type="button" aria-label={`${base} ${label} ${month} ${title}明细`} onClick={() => open(kind, base, month, component, pn)} className="underline decoration-dotted underline-offset-2 hover:text-teal-700">{text}</button>}
      </td>);
    })}
  </tr>;
}

function display(value: unknown): string {
  if (value == null) return '—';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function repairRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item)) : [];
}

function flattenRecord(record: Record<string, unknown>, prefix = ''): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(record)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value)) {
      if (value.length === 0) result[name] = null;
      else value.forEach((item, index) => {
        if (item !== null && typeof item === 'object') Object.assign(result, flattenRecord(item as Record<string, unknown>, `${name}.${index + 1}`));
        else result[`${name}.${index + 1}`] = item ?? null;
      });
    } else if (value !== null && typeof value === 'object') Object.assign(result, flattenRecord(value as Record<string, unknown>, name));
    else result[name] = value as string | number | boolean | null;
  }
  return result;
}

function DetailDialog({ query, onClose }: { query: DetailQuery; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DetailResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [retry, setRetry] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !dialog.current) return;
      const controls = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'));
      if (!controls.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls[controls.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) { event.preventDefault(); controls[0].focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [onClose]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setData(null);
    reinsertApi.details(query, page).then(result => { if (active) setData(result); }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : '明细加载失败');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query, page, retry]);
  const columns = useMemo(() => {
    if (query.kind === 'reinsert' || query.kind === 'repairs') return ['SN', 'NG工站', '记录数', '维修记录'];
    if (query.kind === 'orders') return ['AUFNR', 'VBELN', 'MAKTX_TH', 'LGORT', 'GSTRS', 'GAMNG'];
    if (query.kind === 'postings') return ['AUFNR_1', 'MATNR', 'MAKTX', 'BWART', 'MENGE_A', 'VBELN_EX'];
    return ['PCODE', 'ZNGGZ', 'AUFNR', 'ZBJ', 'ZCCLH', 'ZWXWD3'];
  }, [query.kind]);
  const exportRows = async () => {
    setExporting(true); setError('');
    try {
      const items: Record<string, unknown>[] = [];
      let total = Infinity;
      for (let current = 1; items.length < total; current += 1) {
        const result = await reinsertApi.details(query, current, 200);
        if (total !== Infinity && total !== result.total) throw new Error('数据已变化，请重新查询');
        total = result.total;
        if (!result.items.length && items.length < total) throw new Error('明细分页不完整');
        items.push(...result.items);
      }
      const rows = query.kind === 'reinsert' || query.kind === 'repairs'
        ? items.flatMap(item => repairRecords(item['维修记录']).map(record => flattenRecord(record)))
        : items.map(item => flattenRecord(item));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), '明细');
      XLSX.writeFile(workbook, `${labels[query.kind]}_${query.dateFrom}_${query.dateTo}.xlsx`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '导出失败'); }
    finally { setExporting(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="reinsert-detail-title" className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-md bg-white shadow-xl">
      <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3"><div><h2 id="reinsert-detail-title" className="font-semibold">{labels[query.kind]}</h2><p className="mt-1 text-xs text-slate-500">{[query.model === undefined ? '' : query.model || '未填写机型', query.base, query.month, query.component, query.pn].filter(Boolean).join(' / ') || `${query.dateFrom} 至 ${query.dateTo}`}</p></div><button ref={close} type="button" onClick={onClose} title="关闭" aria-label="关闭明细" className="rounded p-1 hover:bg-slate-100"><X className="size-5" /></button></header>
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 text-xs"><span>{loading ? '加载中...' : `共 ${data?.total ?? 0} 条`}</span><button type="button" onClick={() => void exportRows()} disabled={loading || !data?.total || exporting} className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1.5 disabled:opacity-40"><Download className="size-4" />{exporting ? '导出中' : '导出明细'}</button></div>
      {error && <p role="alert" className="bg-red-50 px-4 py-2 text-sm text-red-700">{error} <button type="button" className="underline" onClick={() => setRetry(value => value + 1)}>重试</button></p>}
      <div className="min-h-40 overflow-auto">{data && !data.items.length ? <p className="p-8 text-center text-sm text-slate-500">暂无明细</p> : data && <table className="w-full min-w-[720px] text-left text-xs"><thead className="bg-slate-50"><tr>{columns.map(column => <th key={column} className="px-3 py-2">{column}</th>)}</tr></thead><tbody>{data.items.map((row, index) => <tr key={index} className="border-t border-slate-200">{columns.map(column => <td key={column} className="max-w-md whitespace-pre-wrap break-words px-3 py-2 align-top">{column === '维修记录' ? <table className="w-full min-w-[320px] overflow-hidden rounded border border-slate-200 text-left"><thead className="bg-slate-50 text-slate-600"><tr><th className="px-2 py-1.5">故障描述（ZNGWD3）</th><th className="px-2 py-1.5">维修描述（ZWXWD3）</th></tr></thead><tbody>{repairRecords(row[column]).length ? repairRecords(row[column]).map((record, recordIndex) => <tr key={recordIndex} className="border-t border-slate-200"><td className="px-2 py-1.5">{display(record.ZNGWD3)}</td><td className="px-2 py-1.5">{display(record.ZWXWD3)}</td></tr>) : <tr><td colSpan={2} className="px-2 py-1.5 text-slate-400">暂无维修记录</td></tr>}</tbody></table> : display(row[column])}</td>)}</tr>)}</tbody></table>}</div>
      <footer className="flex justify-end gap-3 border-t border-slate-200 px-4 py-3 text-xs"><button type="button" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)} className="rounded border px-3 py-1.5 disabled:opacity-40">上一页</button><span className="py-1.5">第 {page} / {Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 50)))} 页</span><button type="button" disabled={loading || !data || page * data.pageSize >= data.total} onClick={() => setPage(value => value + 1)} className="rounded border px-3 py-1.5 disabled:opacity-40">下一页</button></footer>
    </div>
  </div>;
}
