import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BarChart3, BellRing, ChevronLeft, ChevronRight, Download, FileSearch, RefreshCw, X } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import * as XLSX from 'xlsx';
import { useNavigate } from 'react-router-dom';
import { lrrApi } from '../api/lrrApi';
import LRRFiltersPanel from '../components/lrr/LRRFilters';
import { DashboardSwitcher } from '../components/shared/DashboardSwitcher';
import { LoadingSpinner } from '../components/ui';
import type { LRRFaultDetail, LRRFilters, LRRListResponse } from '../types';

const PAGE_SIZE = 50;
const EMPTY_FILTERS: LRRFilters = { sortBy: 'lrrRate', sortDir: 'desc' };

function lrrColor(rate: number | null) {
  if (rate === null) return 'bg-slate-50 text-slate-400';
  if (rate < 2) return 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100';
  if (rate < 5) return 'bg-amber-50 text-amber-800 hover:bg-amber-100';
  return 'bg-red-50 text-red-800 hover:bg-red-100';
}

function formatUpdatedAt(value: Date | null) {
  return value
    ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value)
    : null;
}

function MonthlyTrendLoading({ overlay = false }: { overlay?: boolean }) {
  if (overlay) {
    return (
      <div role="status" aria-live="polite" className="absolute inset-0 z-10 flex items-center justify-center bg-white/75 backdrop-blur-[1px]">
        <div className="inline-flex items-center gap-2 border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 shadow-sm">
          <LoadingSpinner size="sm" />
          <span>正在更新月度数据...</span>
        </div>
      </div>
    );
  }

  const bars = [42, 68, 50, 78, 60, 88, 55, 72];
  return (
    <div role="status" aria-live="polite" aria-label="正在加载月度数据" className="relative flex h-full flex-col overflow-hidden border border-slate-200 bg-slate-50/40 px-4 py-5">
      <div className="absolute inset-x-0 top-0 h-1 bg-slate-100">
        <div className="lrr-loading-progress h-full w-2/5 bg-blue-500" />
      </div>
      <div className="flex min-h-0 flex-1 items-end gap-2 border-b border-l border-slate-200 px-3 pt-8 sm:gap-3">
        {bars.map((height, index) => (
          <span
            key={index}
            className="lrr-loading-bar min-w-3 flex-1 bg-blue-200/80"
            style={{ height: `${height}%`, animationDelay: `${index * 90}ms` }}
          />
        ))}
      </div>
      <div className="flex justify-between gap-3 px-3 pt-2">
        {bars.slice(0, 6).map((_, index) => <span key={index} className="h-2 flex-1 bg-slate-200" />)}
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="inline-flex items-center gap-2 border border-slate-200 bg-white/95 px-3 py-2 text-sm text-slate-500 shadow-sm">
          <LoadingSpinner size="sm" />
          <span>正在加载月度数据...</span>
        </div>
      </div>
    </div>
  );
}

function DetailModal({ title, items, onClose }: { title: string; items: LRRFaultDetail[]; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.offsetParent !== null);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (!dialogRef.current.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="lrr-detail-title" className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3"><h2 id="lrr-detail-title" className="text-sm font-semibold text-slate-800">{title}</h2><button ref={closeButtonRef} type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-200" aria-label="关闭" title="关闭"><X className="size-4" /></button></div>
      <div className="overflow-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="sticky top-0 bg-slate-100 text-slate-600"><tr>{['生产订单', '销售订单', '物料号', '基地', '客户 ID', 'SN', '故障类型', '故障描述', '维修时间'].map((name) => <th key={name} className="px-3 py-2 font-semibold">{name}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{items.map((item, index) => <tr key={`${item.productionOrder}-${item.sn}-${index}`} className="text-slate-600 hover:bg-blue-50/40"><td className="px-3 py-2 font-mono">{item.productionOrder || '-'}</td><td className="px-3 py-2 font-mono">{item.salesOrder || '-'}</td><td className="px-3 py-2 font-mono">{item.materialNumber || '-'}</td><td className="px-3 py-2">{item.base || '-'}</td><td className="px-3 py-2">{item.customerId || '-'}</td><td className="px-3 py-2 font-mono">{item.sn || '-'}</td><td className="px-3 py-2">{item.faultType || '-'}</td><td className="max-w-[240px] truncate px-3 py-2" title={item.faultDesc}>{item.faultDesc || '-'}</td><td className="px-3 py-2">{item.repairTime || '-'}</td></tr>)}</tbody></table>{!items.length && <p className="px-4 py-12 text-center text-sm text-slate-400">暂无故障明细</p>}</div>
    </div>
  </div>;
}

export default function LRRPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<LRRFilters>(EMPTY_FILTERS);
  const [response, setResponse] = useState<LRRListResponse | null>(null);
  const [detailItems, setDetailItems] = useState<LRRFaultDetail[] | null>(null);
  const [detailTitle, setDetailTitle] = useState('LRR 故障明细');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);
  const [dataUpdatedAt, setDataUpdatedAt] = useState<Date | null>(null);
  const requestSequence = useRef(0);
  const detailRequestSequence = useRef(0);

  const load = useCallback(async (targetPage: number, nextFilters: LRRFilters) => {
    const sequence = ++requestSequence.current;
    setLoading(true); setError(false);
    try { const result = await lrrApi.getLRRData(targetPage, PAGE_SIZE, nextFilters); if (sequence === requestSequence.current) { setResponse(result); setPage(result.page); setDataUpdatedAt(new Date()); } }
    catch (err) { console.error('Failed to fetch LRR data', err); if (sequence === requestSequence.current) setError(true); }
    finally { if (sequence === requestSequence.current) setLoading(false); }
  }, []);

  useEffect(() => { load(1, EMPTY_FILTERS); }, [load]);
  const applyFilters = useCallback((nextFilters: LRRFilters) => { setFilters(nextFilters); setPage(1); load(1, nextFilters); }, [load]);
  const reset = () => { setFilters(EMPTY_FILTERS); setPage(1); load(1, EMPTY_FILTERS); };
  const openDetails = async (nextFilters: LRRFilters, title: string) => {
    const sequence = ++detailRequestSequence.current;
    const detailFilters = { ...nextFilters };
    (['materialNumber', 'base', 'customerId', 'month'] as const).forEach((key) => {
      if (detailFilters[key]?.includes(',')) delete detailFilters[key];
    });
    try { const result = await lrrApi.getFaultDetails(detailFilters); if (sequence === detailRequestSequence.current) { setDetailItems(result.items); setDetailTitle(result.truncated ? `${title}（前 ${result.items.length.toLocaleString()} 条）` : title); } } catch { if (sequence === detailRequestSequence.current) { setDetailItems([]); setDetailTitle(title); } }
  };
  const closeDetails = useCallback(() => { detailRequestSequence.current += 1; setDetailItems(null); }, []);
  const handleExport = async () => { setExporting(true); try { const result = await lrrApi.getFaultDetails(filters); const rows = result.items.map((item) => ({ 生产订单: item.productionOrder, 销售订单: item.salesOrder, 物料号: item.materialNumber, 基地: item.base, 客户ID: item.customerId, SN: item.sn, 故障类型: item.faultType, 故障描述: item.faultDesc, 维修时间: item.repairTime })); const sheet = XLSX.utils.json_to_sheet(rows); const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'LRR故障明细'); XLSX.writeFile(book, `LRR故障明细_${new Date().toISOString().slice(0, 10)}.xlsx`); } catch (err) { console.error('LRR export failed', err); } finally { setExporting(false); } };

  const data = response?.items ?? [];
  const totalPages = Math.max(1, Math.ceil((response?.total ?? 0) / PAGE_SIZE));
  const trend = useMemo(() => { const map = new Map<string, { month: string; quantity: number; faults: number }>(); data.forEach((row) => { const month = row.month || '未知'; const item = map.get(month) ?? { month, quantity: 0, faults: 0 }; item.quantity += row.issuedQuantity; item.faults += row.faultCount; map.set(month, item); }); return [...map.values()].sort((a, b) => a.month.localeCompare(b.month)); }, [data]);
  const summary = response?.summary;
  const updatedAt = formatUpdatedAt(dataUpdatedAt);

  return <div className="min-h-screen bg-[#f6f8fb] text-slate-800">
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex min-h-15 max-w-[1600px] items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <button type="button" onClick={() => navigate('/')} className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600" title="返回首页" aria-label="返回首页"><ArrowLeft className="size-4" /></button>
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-cyan-600 text-white"><BellRing className="size-4" /></div>
          <div className="min-w-0"><h1 className="truncate text-base font-semibold text-slate-900">LRR 部件故障率</h1><p className="hidden text-xs text-slate-500 sm:block">生产订单部件故障率分析</p></div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <DashboardSwitcher />
          <button type="button" onClick={() => openDetails(filters, 'LRR 故障详细列表')} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700 sm:px-3" title="查看故障详细列表" aria-label="查看故障详细列表"><FileSearch className="size-4" /><span className="hidden sm:inline">详情</span></button>
          <button type="button" onClick={() => load(page, filters)} disabled={loading} className="inline-flex size-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-45" title="刷新" aria-label="刷新"><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /></button>
          <button type="button" onClick={handleExport} disabled={exporting || !summary?.totalFaults} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-45 sm:px-3" title="导出故障明细" aria-label="导出故障明细"><Download className="size-4" /><span className="hidden sm:inline">导出</span></button>
        </div>
      </div>
    </header>
    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-4 py-4 sm:px-6 lg:px-8">
      <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 xl:flex-row xl:items-center xl:justify-between"><div><h2 className="text-sm font-semibold text-slate-800">当前周期 LRR 概览</h2><p className="mt-0.5 text-xs text-slate-500">按生产订单基地归属统计，点击故障数可查看 SN 明细</p></div><div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">{updatedAt && <span>更新于 {updatedAt}</span>}{response && <span className="font-medium text-slate-700">{response.total.toLocaleString('zh-CN')} 条订单记录</span>}<span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-emerald-500" />达标 &lt; 2%</span><span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-amber-500" />关注 2% - 5%</span><span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-red-500" />异常 &gt;= 5%</span></div></div>
        <div className="grid grid-cols-2 divide-x divide-y divide-slate-200 border-b border-slate-200 lg:grid-cols-4 lg:divide-y-0">
          {[
            ['统计订单数', summary?.orderCount ?? 0, '生产订单维度'],
            ['周期内累计投入', summary?.issuedQuantity ?? 0, 'BOM MENGE_A 汇总'],
            ['周期内总故障数', summary?.totalFaults ?? 0, '点击分子查看明细'],
            ['综合 LRR', summary?.overallLrr == null ? '-' : `${summary.overallLrr}%`, '按当前筛选范围'],
          ].map(([label, value, detail]) => <div key={String(label)} className="min-w-0 bg-slate-50/70 px-4 py-3.5">
            <div className="text-xs font-medium text-slate-500">{label}</div>
            <div className="mt-1 truncate font-mono text-xl font-bold text-slate-800">{typeof value === 'number' ? value.toLocaleString() : value}</div>
            <div className="mt-1 truncate text-[11px] text-slate-400">{detail}</div>
          </div>)}
        </div>
        <LRRFiltersPanel filters={filters} onSearch={applyFilters} onReset={reset} />
        {error && <div className="border-t border-red-200 bg-red-50 px-5 py-2.5 text-xs text-red-700">LRR 数据加载失败，请点击刷新重试。</div>}
      </section>
      <section className="overflow-hidden rounded-md border border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2"><BarChart3 className="size-4 text-cyan-700" /><h2 className="text-sm font-semibold text-slate-800">月度 LRR 趋势</h2></div>
          <div className="flex items-center gap-4 text-xs text-slate-500"><span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-cyan-600" />物料数量</span><span className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full bg-red-500" />维修故障数</span></div>
        </div>
        <div className="h-64 min-w-0" aria-busy={loading}>
          {trend.length ? (
            <div className="relative h-full">
              <ResponsiveContainer width="100%" height="100%"><BarChart data={trend} margin={{ top: 8, right: 10, left: -20, bottom: 0 }}><CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} /><YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} /><Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(value, name) => [Number(value).toLocaleString(), name === 'quantity' ? '物料数量' : '维修故障数']} /><Bar dataKey="quantity" name="quantity" fill="#0891b2" radius={[2, 2, 0, 0]} maxBarSize={30} /><Bar dataKey="faults" name="faults" fill="#ef4444" radius={[2, 2, 0, 0]} maxBarSize={30} /></BarChart></ResponsiveContainer>
              {loading && <MonthlyTrendLoading overlay />}
            </div>
          ) : loading ? <MonthlyTrendLoading /> : <div className="flex h-full items-center justify-center border border-dashed border-slate-200 text-sm text-slate-400">暂无月度数据</div>}
        </div>
      </section>
      <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 sm:px-5"><div><h2 className="text-sm font-semibold text-slate-800">生产订单 LRR 明细</h2><p className="mt-0.5 text-xs text-slate-500">共 {response?.total?.toLocaleString() ?? 0} 条 · 按生产订单基地归属</p></div><span className="text-xs text-slate-500">故障数 / 物料数量</span></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1080px] border-separate border-spacing-0 text-left text-sm"><thead className="text-xs font-semibold text-slate-600"><tr><th className="sticky left-0 z-20 min-w-24 border-b border-r border-slate-200 bg-slate-50 px-4 py-3 shadow-[1px_0_0_0_rgb(226_232_240)]">月份</th><th className="sticky left-24 z-20 min-w-40 border-b border-r border-slate-200 bg-slate-50 px-4 py-3 shadow-[1px_0_0_0_rgb(226_232_240)]">生产订单</th><th className="border-b border-r border-slate-200 px-4 py-3">物料号</th><th className="border-b border-r border-slate-200 px-4 py-3">基地</th><th className="border-b border-r border-slate-200 px-4 py-3">客户 ID</th><th className="border-b border-r border-slate-200 px-4 py-3 text-right">物料数量</th><th className="border-b border-r border-slate-200 px-4 py-3 text-right">维修故障数</th><th className="border-b border-slate-200 px-4 py-3 text-center">LRR</th></tr></thead><tbody className="text-xs">{loading ? <tr><td colSpan={8} className="px-4 py-16 text-center text-slate-500">正在加载数据...</td></tr> : data.length ? data.map((row) => { const color = lrrColor(row.lrrRate); return <tr key={row.id} className="group"><td className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-4 py-3 font-mono text-slate-600 shadow-[1px_0_0_0_rgb(226_232_240)] group-hover:bg-slate-50">{row.month || '-'}</td><td className="sticky left-24 z-10 border-b border-r border-slate-200 bg-white px-4 py-3 font-mono font-medium text-slate-700 shadow-[1px_0_0_0_rgb(226_232_240)] group-hover:bg-slate-50">{row.orderNo || '-'}</td><td className="border-b border-r border-slate-100 px-4 py-3 font-mono text-slate-600">{row.materialNumber || '-'}</td><td className="border-b border-r border-slate-100 px-4 py-3 text-slate-600">{row.base || '-'}</td><td className="border-b border-r border-slate-100 px-4 py-3 text-slate-600">{row.customerId || '-'}</td><td className="border-b border-r border-slate-100 px-4 py-3 text-right font-mono text-slate-700">{row.issuedQuantity.toLocaleString()}</td><td className="border-b border-r border-slate-100 px-4 py-3 text-right font-mono">{row.faultCount ? <button type="button" onClick={() => openDetails({ ...filters, orderKeyword: row.orderNo, materialNumber: row.materialNumber, base: row.base, customerId: row.customerId, month: row.month }, `${row.orderNo} 故障明细`)} className="font-semibold text-red-700 underline decoration-dotted underline-offset-2 hover:text-red-900" title="查看故障 SN 明细">{row.faultCount.toLocaleString()}</button> : <span className="text-slate-400">0</span>}</td><td className="border-b border-slate-100 p-1.5 text-center"><div className={`flex min-h-13 min-w-28 flex-col items-center justify-center rounded-sm px-2 py-1.5 font-mono ${color}`}><span className="text-sm font-semibold">{row.lrrRate == null ? '-' : `${row.lrrRate}%`}</span><span className="mt-0.5 text-[11px] font-medium opacity-75">{row.faultCount}/{row.issuedQuantity}</span></div></td></tr>; }) : <tr><td colSpan={8} className="px-4 py-16 text-center text-slate-500">暂无符合条件的数据</td></tr>}</tbody></table></div>
        {response && <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500 sm:px-5"><span>第 {page} / {totalPages} 页，共 {response.total.toLocaleString()} 条</span><div className="flex gap-1"><button type="button" onClick={() => { const next = Math.max(1, page - 1); setPage(next); load(next, filters); }} disabled={page <= 1} className="inline-flex size-8 items-center justify-center rounded-md border border-slate-300 bg-white hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40" title="上一页" aria-label="上一页"><ChevronLeft className="size-3.5" /></button><button type="button" onClick={() => { const next = Math.min(totalPages, page + 1); setPage(next); load(next, filters); }} disabled={page >= totalPages} className="inline-flex size-8 items-center justify-center rounded-md border border-slate-300 bg-white hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40" title="下一页" aria-label="下一页"><ChevronRight className="size-3.5" /></button></div></div>}
      </section>
    </main>{detailItems && <DetailModal title={detailTitle} items={detailItems} onClose={closeDetails} />}
  </div>;
}
