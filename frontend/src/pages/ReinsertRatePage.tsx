import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, ArrowLeft, ChevronDown, ChevronRight, Download, RotateCcw, Search, Wrench, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Bar, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import * as XLSX from 'xlsx';
import { reinsertApi, type DetailKind, type DetailQuery, type DetailResult, type ReinsertBase, type ReinsertCell, type ReinsertDashboard, type ReinsertQuery } from '../api/reinsertApi';
import { DashboardSwitcher } from '../components/shared/DashboardSwitcher';
import { HelpTooltip } from '../components/shared/HelpTooltip';
import { DateRangePicker } from '../components/shared/DateRangePicker';
import { MultiSelect } from '../components/shared/MultiSelect';
import { recentDateRange } from '../utils/dateRange';

const colors = ['#0f766e', '#2563eb', '#d97706', '#be185d', '#7c3aed'];
const labels: Record<DetailKind, string> = { reinsert: '重插事件', repairs: '全部维修事件', orders: '计划订单', postings: '发退料记录', invalid: '缺少SN或NG工站的记录' };
const number = (value: number | null) => value == null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const rate = (value: number | null) => value == null ? '—' : `${value.toFixed(2)}%`;

function initialQuery(): ReinsertQuery {
  const { from, to } = recentDateRange();
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
  const [detail, setDetail] = useState<DetailQuery | null>(null);
  const [selectedBase, setSelectedBase] = useState<string | null>(null);
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
  const open = (kind: DetailKind, base = '', month = '', component = '', pn = '') =>
    setDetail({ ...applied, kind, base, month, component, pn });
  const close = useCallback(() => setDetail(null), []);
  const activeBase = data?.bases.find(base => base.base === selectedBase);

  return <div className="min-h-screen bg-slate-50 text-slate-800">
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-4 backdrop-blur">
      <div className="mx-auto flex min-h-15 max-w-[1720px] items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <button type="button" onClick={() => navigate('/')} title="返回首页" aria-label="返回首页" className="inline-flex size-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"><ArrowLeft className="size-4" /></button>
          <span className="flex size-8 items-center justify-center rounded-md bg-teal-50 text-teal-700"><Wrench className="size-4" /></span>
          <div className="flex items-center gap-1"><h1 className="text-base font-semibold text-slate-900">重插率分析</h1><HelpTooltip label="查看重插率分析维度">按基地、部件和物料 PN 展示重插表现。</HelpTooltip></div>
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
      </form>
      {optionsError && <p role="alert" className="text-xs text-amber-700">筛选项加载失败：{optionsError}</p>}
      {error && <div role="alert" className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error} <button type="button" className="underline" onClick={() => void load(draft)}>重试</button></div>}
      {loading && <div role="status" className="py-16 text-center text-sm text-slate-500">正在汇总订单、维修与发料记录...</div>}
      {data && <>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
          <div><h2 className="text-sm font-semibold">月度重插表现</h2><p className="mt-1 text-xs text-slate-500">{applied.dateFrom} 至 {applied.dateTo} · 订单计划月</p></div>
          {data.invalidCount > 0 && <button type="button" onClick={() => open('invalid')} className="inline-flex items-center gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800 underline decoration-dotted"><AlertTriangle className="size-3.5" />{data.invalidCount} 条记录缺少 SN 或工站（重插 {data.invalidReinsertCount} 条）</button>}
        </div>
        {!data.bases.length ? <div className="py-16 text-center text-sm text-slate-500">当前筛选条件下没有订单数据</div>
          : activeBase ? <BaseSection key={activeBase.base} base={activeBase} months={data.months} open={open} onBack={() => setSelectedBase(null)} />
            : <BaseOverview bases={data.bases} months={data.months} open={open} onSelect={setSelectedBase} />}
      </>}
    </main>
    {detail && <DetailDialog query={detail} onClose={close} />}
  </div>;
}

type OpenDetail = (kind: DetailKind, base?: string, month?: string, component?: string, pn?: string) => void;

function BaseOverview({ bases, months, open, onSelect }: { bases: ReinsertBase[]; months: string[]; open: OpenDetail; onSelect: (base: string) => void }) {
  return <section aria-labelledby="base-overview-title">
    <div className="flex items-baseline justify-between gap-3 py-2">
      <h2 id="base-overview-title" className="text-sm font-semibold text-slate-900">基地汇总</h2>
      <span className="text-xs text-slate-500">{bases.length} 个基地</span>
    </div>
    <div className="overflow-auto border border-slate-300 bg-white">
      <table className="w-full min-w-max border-collapse text-right text-xs tabular-nums">
        <thead className="bg-slate-100 text-slate-700">
          <tr><th rowSpan={2} className="sticky left-0 z-10 min-w-44 border border-slate-300 bg-slate-100 px-3 py-2 text-left">基地</th>{months.map(month => <th key={month} colSpan={4} className="border border-slate-300 px-2 py-2 text-center">{month}</th>)}</tr>
          <tr>{months.flatMap(month => ['重插数', '维修数', '计划量', '整机重插率'].map(label => <th key={`${month}-${label}`} className="border border-slate-300 px-2 py-1.5">{label}</th>))}</tr>
        </thead>
        <tbody>{bases.map(base => <tr key={base.base} className="hover:bg-teal-50/40">
          <th className="sticky left-0 z-[1] border border-slate-200 bg-white px-3 py-2 text-left font-medium">
            <button type="button" onClick={() => onSelect(base.base)} aria-label={`查看${base.base}基地详情`} className="inline-flex items-center gap-1 text-teal-800 hover:underline">
              <ChevronRight className="size-4 shrink-0" />{base.base}
            </button>
          </th>
          {months.flatMap(month => {
            const value = base.months[month];
            const cells: [string, DetailKind, string][] = [
              [number(value.reinsertCount), 'reinsert', '重插数'], [number(value.repairCount), 'repairs', '维修数'],
              [number(value.plannedQuantity), 'orders', '计划量'], [rate(value.plannedRate), 'reinsert', '整机重插率'],
            ];
            return cells.map(([text, kind, title]) => <td key={`${month}-${title}`} className="border border-slate-200 px-2 py-2" title={text === '—' ? '计划量缺失或不大于零' : undefined}>
              {text === '—' ? <span className="text-slate-400">—</span> : <button type="button" aria-label={`${base.base} ${month} ${title}明细`} onClick={() => open(kind, base.base, month)} className="underline decoration-dotted underline-offset-2 hover:text-teal-700">{text}</button>}
            </td>);
          })}
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

function BaseSection({ base, months, open, onBack }: { base: ReinsertBase; months: string[]; open: OpenDetail; onBack: () => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const chart = months.map(month => ({ month, count: base.months[month].reinsertCount, rate: base.months[month].plannedRate }));
  const pnChart = months.map(month => Object.fromEntries([['month', month], ...base.topPns.map((item, index) => [`pn${index}`, item.months[month].plannedRate])]));
  const toggle = (component: string) => setExpanded(current => {
    const next = new Set(current);
    if (next.has(component)) next.delete(component); else next.add(component);
    return next;
  });
  return <section className="border-b border-slate-300 pb-5">
    <div className="flex flex-wrap items-center gap-3 py-2">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-xs text-teal-700 hover:underline"><ArrowLeft className="size-3.5" />基地汇总</button>
      <span className="h-4 w-px bg-slate-300" />
      <h2 className="text-sm font-semibold text-slate-900">{base.base}</h2>
    </div>
    <div className="grid min-w-0 grid-cols-1 gap-5 py-2 xl:grid-cols-2">
      <figure className="min-w-0"><figcaption className="mb-2 flex items-center gap-1 text-xs font-semibold">月度重插数与整机口径重插率<HelpTooltip label="查看整机口径重插率说明">柱线图展示每月重插数量与整机计划量口径的重插率。</HelpTooltip></figcaption>
        <div className="h-52" role="img" aria-label={`${base.base}月度重插数与重插率`}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0}><ComposedChart data={chart} margin={{ left: 0, right: 5 }}>
            <CartesianGrid stroke="#e2e8f0" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 10 }} /><YAxis yAxisId="count" allowDecimals={false} width={38} tick={{ fontSize: 10 }} /><YAxis yAxisId="rate" orientation="right" width={48} tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} /><Tooltip formatter={(value, name) => name === '重插率' ? [`${value}%`, name] : [value, name]} /><Bar yAxisId="count" dataKey="count" name="重插数" fill="#0f766e" maxBarSize={28} isAnimationActive={false} /><Line yAxisId="rate" dataKey="rate" name="重插率" stroke="#d97706" strokeWidth={2} connectNulls={false} isAnimationActive={false} />
          </ComposedChart></ResponsiveContainer>
        </div>
      </figure>
      <figure className="min-w-0"><figcaption className="mb-2 flex items-center gap-1 text-xs font-semibold">PN Top 5 月度重插率<HelpTooltip label="查看 PN 月度重插率说明">展示基地内重插率排名前五的 PN 在各月份的重插率。</HelpTooltip></figcaption>
        <div className="h-52" role="img" aria-label={`${base.base} PN前五月度重插率`}>
          {base.topPns.length ? <ResponsiveContainer width="100%" height="100%" minWidth={0}><LineChart data={pnChart} margin={{ left: 0, right: 5 }}>
            <CartesianGrid stroke="#e2e8f0" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 10 }} /><YAxis width={48} tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} /><Tooltip formatter={(value, name) => [`${value}%`, name]} />{base.topPns.map((item, index) => <Line key={item.pn} dataKey={`pn${index}`} name={item.pn} stroke={colors[index]} strokeWidth={2} connectNulls={false} isAnimationActive={false} />)}
          </LineChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center text-xs text-slate-400">暂无 PN 数据</div>}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">{base.topPns.map((item, index) => <span key={item.pn} className="inline-flex items-center gap-1 text-slate-600"><span className="size-2 rounded-sm" style={{ backgroundColor: colors[index] }} />{item.pn}</span>)}</div>
      </figure>
    </div>
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
      const rows = items.map(item => Object.fromEntries(columns.map(column => [column, display(item[column])])));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), '明细');
      XLSX.writeFile(workbook, `${labels[query.kind]}_${query.dateFrom}_${query.dateTo}.xlsx`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '导出失败'); }
    finally { setExporting(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="reinsert-detail-title" className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-md bg-white shadow-xl">
      <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3"><div><h2 id="reinsert-detail-title" className="font-semibold">{labels[query.kind]}</h2><p className="mt-1 text-xs text-slate-500">{[query.base, query.month, query.component, query.pn].filter(Boolean).join(' / ') || `${query.dateFrom} 至 ${query.dateTo}`}</p></div><button ref={close} type="button" onClick={onClose} title="关闭" aria-label="关闭明细" className="rounded p-1 hover:bg-slate-100"><X className="size-5" /></button></header>
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 text-xs"><span>{loading ? '加载中...' : `共 ${data?.total ?? 0} 条`}</span><button type="button" onClick={() => void exportRows()} disabled={loading || !data?.total || exporting} className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1.5 disabled:opacity-40"><Download className="size-4" />{exporting ? '导出中' : '导出明细'}</button></div>
      {error && <p role="alert" className="bg-red-50 px-4 py-2 text-sm text-red-700">{error} <button type="button" className="underline" onClick={() => setRetry(value => value + 1)}>重试</button></p>}
      <div className="min-h-40 overflow-auto">{data && !data.items.length ? <p className="p-8 text-center text-sm text-slate-500">暂无明细</p> : data && <table className="w-full min-w-[720px] text-left text-xs"><thead className="bg-slate-50"><tr>{columns.map(column => <th key={column} className="px-3 py-2">{column}</th>)}</tr></thead><tbody>{data.items.map((row, index) => <tr key={index} className="border-t border-slate-200">{columns.map(column => <td key={column} className="max-w-md whitespace-pre-wrap break-all px-3 py-2">{display(row[column])}</td>)}</tr>)}</tbody></table>}</div>
      <footer className="flex justify-end gap-3 border-t border-slate-200 px-4 py-3 text-xs"><button type="button" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)} className="rounded border px-3 py-1.5 disabled:opacity-40">上一页</button><span className="py-1.5">第 {page} / {Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 50)))} 页</span><button type="button" disabled={loading || !data || page * data.pageSize >= data.total} onClick={() => setPage(value => value + 1)} className="rounded border px-3 py-1.5 disabled:opacity-40">下一页</button></footer>
    </div>
  </div>;
}
