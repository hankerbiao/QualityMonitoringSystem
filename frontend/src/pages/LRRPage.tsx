import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BarChart3, ChevronLeft, ChevronRight, Download, FileText, RefreshCw, X } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import * as XLSX from 'xlsx';
import { useNavigate } from 'react-router-dom';
import { lrrApi } from '../api/lrrApi';
import LRRFiltersPanel from '../components/lrr/LRRFilters';
import { DashboardSwitcher } from '../components/shared/DashboardSwitcher';
import type { LRRFaultDetail, LRRFilters, LRRListResponse } from '../types';

const PAGE_SIZE = 50;
const EMPTY_FILTERS: LRRFilters = { sortBy: 'lrrRate', sortDir: 'desc' };

function lrrColor(rate: number | null) {
  if (rate === null) return { text: 'text-slate-400', bar: '#cbd5e1' };
  if (rate < 2) return { text: 'text-emerald-600', bar: '#10b981' };
  if (rate < 5) return { text: 'text-amber-600', bar: '#f59e0b' };
  return { text: 'text-red-600', bar: '#ef4444' };
}

function DetailModal({ title, items, onClose }: { title: string; items: LRRFaultDetail[]; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
    <div className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3"><h2 className="text-sm font-semibold text-slate-800">{title}</h2><button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-200" aria-label="关闭"><X className="size-4" /></button></div>
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
  const requestSequence = useRef(0);

  const load = useCallback(async (targetPage: number, nextFilters: LRRFilters) => {
    const sequence = ++requestSequence.current;
    setLoading(true); setError(false);
    try { const result = await lrrApi.getLRRData(targetPage, PAGE_SIZE, nextFilters); if (sequence === requestSequence.current) { setResponse(result); setPage(result.page); } }
    catch (err) { console.error('Failed to fetch LRR data', err); if (sequence === requestSequence.current) setError(true); }
    finally { if (sequence === requestSequence.current) setLoading(false); }
  }, []);

  useEffect(() => { load(1, EMPTY_FILTERS); }, [load]);
  const applyFilters = useCallback((patch: Partial<LRRFilters>) => { const next = { ...filters, ...patch }; setFilters(next); setPage(1); load(1, next); }, [filters, load]);
  const reset = () => { setFilters(EMPTY_FILTERS); setPage(1); load(1, EMPTY_FILTERS); };
  const openDetails = async (nextFilters: LRRFilters, title: string) => {
    const detailFilters = { ...nextFilters };
    (['materialNumber', 'base', 'customerId', 'month'] as const).forEach((key) => {
      if (detailFilters[key]?.includes(',')) delete detailFilters[key];
    });
    try { const result = await lrrApi.getFaultDetails(detailFilters); setDetailItems(result.items); setDetailTitle(result.truncated ? `${title}（前 ${result.items.length.toLocaleString()} 条）` : title); } catch { setDetailItems([]); setDetailTitle(title); }
  };
  const handleExport = async () => { setExporting(true); try { const result = await lrrApi.getFaultDetails(filters); const rows = result.items.map((item) => ({ 生产订单: item.productionOrder, 销售订单: item.salesOrder, 物料号: item.materialNumber, 基地: item.base, 客户ID: item.customerId, SN: item.sn, 故障类型: item.faultType, 故障描述: item.faultDesc, 维修时间: item.repairTime })); const sheet = XLSX.utils.json_to_sheet(rows); const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'LRR故障明细'); XLSX.writeFile(book, `LRR故障明细_${new Date().toISOString().slice(0, 10)}.xlsx`); } catch (err) { console.error('LRR export failed', err); } finally { setExporting(false); } };

  const data = response?.items ?? [];
  const totalPages = Math.max(1, Math.ceil((response?.total ?? 0) / PAGE_SIZE));
  const trend = useMemo(() => { const map = new Map<string, { month: string; quantity: number; faults: number }>(); data.forEach((row) => { const month = row.month || '未知'; const item = map.get(month) ?? { month, quantity: 0, faults: 0 }; item.quantity += row.issuedQuantity; item.faults += row.faultCount; map.set(month, item); }); return [...map.values()].sort((a, b) => a.month.localeCompare(b.month)); }, [data]);
  const summary = response?.summary;

  return <div className="min-h-screen bg-slate-50 text-slate-800"><header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur"><div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><button type="button" onClick={() => navigate('/')} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" title="返回首页"><ArrowLeft className="size-4" /></button><div><h1 className="text-lg font-semibold text-slate-900">LRR 部件故障率看板</h1><p className="text-xs text-slate-400">生产订单基地 · 物料号 · 月度 BOM 投入与维修故障</p></div></div><div className="flex items-center gap-2"><DashboardSwitcher /><button type="button" onClick={() => openDetails(filters, 'LRR 故障详细列表')} className="flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:border-blue-300 hover:bg-blue-50"><FileText className="size-4" />详情</button><button type="button" onClick={() => load(page, filters)} disabled={loading} className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50" title="刷新"><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} /></button><button type="button" onClick={handleExport} disabled={exporting || !summary?.totalFaults} className="flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:border-blue-300 hover:bg-blue-50 disabled:opacity-40"><Download className="size-4" />导出</button></div></div></header>
    <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 p-4"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[['统计订单数', summary?.orderCount ?? 0, '生产订单维度'], ['物料数量', summary?.issuedQuantity ?? 0, 'BOM MENGE_A 汇总'], ['维修故障数', summary?.totalFaults ?? 0, '点击分子查看明细'], ['整体 LRR', summary?.overallLrr == null ? '-' : `${summary.overallLrr}%`, '按当前筛选范围']].map(([label, value, detail]) => <div key={String(label)} className="rounded-md border border-slate-200 bg-white px-4 py-3 shadow-sm"><div className="text-[11px] text-slate-500">{label}</div><div className="mt-1 font-mono text-xl font-bold text-slate-800">{typeof value === 'number' ? value.toLocaleString() : value}</div><div className="text-[11px] text-slate-400">{detail}</div></div>)}</div><LRRFiltersPanel filters={filters} onChange={applyFilters} onReset={reset} />{error && <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">LRR 数据加载失败，请点击刷新重试。</div>}
      <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800"><BarChart3 className="size-4 text-blue-600" />月度 LRR 趋势</div><div className="h-64">{trend.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={trend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}><CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip formatter={(value, name) => [Number(value).toLocaleString(), name === 'quantity' ? '物料数量' : '维修故障数']} /><Bar dataKey="quantity" name="quantity" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={28} /><Bar dataKey="faults" name="faults" fill="#ef4444" radius={[3, 3, 0, 0]} maxBarSize={28} /></BarChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center text-sm text-slate-400">暂无月度数据</div>}</div></section>
      <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-4 py-3"><h2 className="text-sm font-semibold text-slate-800">生产订单 LRR 明细</h2><p className="mt-1 text-xs text-slate-400">共 {response?.total?.toLocaleString() ?? 0} 条 · 按生产订单基地归属</p></div><div className="overflow-auto"><table className="w-full min-w-[1080px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-2.5">月份</th><th className="px-4 py-2.5">生产订单</th><th className="px-4 py-2.5">物料号</th><th className="px-4 py-2.5">基地</th><th className="px-4 py-2.5">客户 ID</th><th className="px-4 py-2.5">物料数量（分母）</th><th className="px-4 py-2.5">维修故障数（分子）</th><th className="px-4 py-2.5">LRR</th></tr></thead><tbody className="divide-y divide-slate-100 text-xs">{loading ? <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-400">正在加载数据...</td></tr> : data.length ? data.map((row) => { const color = lrrColor(row.lrrRate); return <tr key={row.id} className="hover:bg-blue-50/40"><td className="px-4 py-2.5 font-mono">{row.month || '-'}</td><td className="px-4 py-2.5 font-mono font-medium text-slate-700">{row.orderNo}</td><td className="px-4 py-2.5 font-mono">{row.materialNumber || '-'}</td><td className="px-4 py-2.5">{row.base || '-'}</td><td className="px-4 py-2.5">{row.customerId || '-'}</td><td className="px-4 py-2.5 font-mono">{row.issuedQuantity.toLocaleString()}</td><td className="px-4 py-2.5 font-mono">{row.faultCount ? <button type="button" onClick={() => openDetails({ ...filters, materialNumber: row.materialNumber, base: row.base, customerId: row.customerId, month: row.month }, `${row.orderNo} 故障明细`)} className="font-semibold text-red-600 underline decoration-dotted underline-offset-2 hover:text-red-800">{row.faultCount.toLocaleString()}</button> : <span>0</span>}</td><td className={`px-4 py-2.5 font-semibold ${color.text}`}>{row.lrrRate == null ? '-' : `${row.lrrRate}%`}</td></tr>; }) : <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-400">暂无符合条件的数据</td></tr>}</tbody></table></div>{response && <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 px-4 py-3 text-xs text-slate-500"><span>第 {page} / {totalPages} 页</span><div className="flex gap-1"><button type="button" onClick={() => { const next = Math.max(1, page - 1); setPage(next); load(next, filters); }} disabled={page <= 1} className="rounded border border-slate-200 bg-white p-1.5 disabled:opacity-40"><ChevronLeft className="size-3.5" /></button><button type="button" onClick={() => { const next = Math.min(totalPages, page + 1); setPage(next); load(next, filters); }} disabled={page >= totalPages} className="rounded border border-slate-200 bg-white p-1.5 disabled:opacity-40"><ChevronRight className="size-3.5" /></button></div></div>}</section>
    </main>{detailItems && <DetailModal title={detailTitle} items={detailItems} onClose={() => setDetailItems(null)} />}</div>;
}
