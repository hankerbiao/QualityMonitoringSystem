import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Download, Package, RefreshCw, Search, TrendingUp, Wrench } from 'lucide-react';
import * as XLSX from 'xlsx';
import { lrrApi } from '../api/lrrApi';
import LRRFiltersPanel from '../components/lrr/LRRFilters';
import { SortIcon } from '../components/shared/SortIcon';
import type { LRRData, LRRFilters, LRRListResponse, LRROptions, LRRSortField } from '../types';

const HIGH_RISK_THRESHOLD = 5;
const PAGE_SIZE = 50;
const EMPTY_OPTIONS: LRROptions = { productionOrders: [], salesOrders: [], storageLocations: [] };
const EMPTY_FILTERS: LRRFilters = { sortBy: 'lrrRate', sortDir: 'desc' };

function normalizeOptions(value: Partial<LRROptions> | null | undefined): LRROptions {
  return {
    productionOrders: Array.isArray(value?.productionOrders) ? value.productionOrders : [],
    salesOrders: Array.isArray(value?.salesOrders) ? value.salesOrders : [],
    storageLocations: Array.isArray(value?.storageLocations) ? value.storageLocations : [],
  };
}

function lrrColor(rate: number | null) {
  if (rate === null) return { text: 'text-slate-400', bar: '#cbd5e1' };
  if (rate < 2) return { text: 'text-emerald-600', bar: '#10b981' };
  if (rate < HIGH_RISK_THRESHOLD) return { text: 'text-amber-600', bar: '#f59e0b' };
  return { text: 'text-red-600', bar: '#ef4444' };
}

export default function LRRPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<LRRFilters>(EMPTY_FILTERS);
  const [options, setOptions] = useState<LRROptions>(EMPTY_OPTIONS);
  const [response, setResponse] = useState<LRRListResponse | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async (targetPage: number, nextFilters: LRRFilters) => {
    setLoading(true); setError(false);
    try { const result = await lrrApi.getLRRData(targetPage, PAGE_SIZE, nextFilters); setResponse(result); setPage(result.page); }
    catch (err) { console.error('Failed to fetch LRR data', err); setError(true); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    lrrApi.getOptions().then((value) => setOptions(normalizeOptions(value))).catch((err) => console.error('Failed to fetch LRR options', err));
    load(1, EMPTY_FILTERS);
  }, [load]);

  const applyFilters = (patch: Partial<LRRFilters>) => {
    const next = { ...filters, ...patch };
    setFilters(next); setPage(1); load(1, next);
  };
  const handleSort = (field: LRRSortField) => {
    const direction = filters.sortBy === field && filters.sortDir === 'desc' ? 'asc' : 'desc';
    applyFilters({ sortBy: field, sortDir: direction });
  };
  const handleExport = async () => {
    setExporting(true);
    try {
      const details = await lrrApi.getFaultDetails(filters);
      const rows = details.map((item) => ({ PN: item.materialNo, 物料描述: item.materialDesc, 生产订单: item.productionOrder, 销售订单: item.salesOrder, 库存点: item.storageLocation, SN: item.sn, 故障类型: item.faultType, 故障描述: item.faultDesc, 维修时间: item.repairTime }));
      const sheet = XLSX.utils.json_to_sheet(rows);
      const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'LRR故障明细');
      XLSX.writeFile(book, `LRR故障明细_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) { console.error('LRR export failed', err); alert('导出失败，请重试'); }
    finally { setExporting(false); }
  };

  const data: LRRData[] = response?.items ?? [];
  const filteredData = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return keyword ? data.filter((row) => row.materialNo.toLowerCase().includes(keyword) || row.materialDesc.toLowerCase().includes(keyword)) : data;
  }, [data, search]);
  const summary = response?.summary;
  const totalPages = Math.max(1, Math.ceil((response?.total ?? 0) / PAGE_SIZE));
  const highRisk = data.filter((row) => row.lrrRate !== null && row.lrrRate >= HIGH_RISK_THRESHOLD).length;
  const cards = [
    { label: '物料种类', value: summary?.materialKinds ?? 0, detail: 'MATNR 后8位分组', icon: Package, tint: 'text-blue-600 bg-blue-50' },
    { label: '净发料数量', value: summary?.issuedQuantity ?? 0, detail: 'MENGE_A 带符号汇总', icon: Wrench, tint: 'text-indigo-600 bg-indigo-50' },
    { label: '故障件次', value: summary?.totalFaults ?? 0, detail: '按订单关联故障看板', icon: AlertTriangle, tint: 'text-red-600 bg-red-50' },
    { label: '整体 LRR', value: summary?.overallLrr == null ? '-' : `${summary.overallLrr}%`, detail: `当前页高风险 ${highRisk} 种`, icon: TrendingUp, tint: 'text-emerald-600 bg-emerald-50' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3"><button type="button" onClick={() => navigate('/')} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" title="返回首页"><ArrowLeft className="h-4 w-4" /></button><div><h1 className="text-lg font-semibold text-slate-900">LRR 订单 BOM 故障率</h1><p className="text-xs text-slate-400">发料数量分母 · 故障看板分子</p></div></div>
          <div className="flex items-center gap-2"><button type="button" onClick={() => load(page, filters)} disabled={loading} className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50" title="刷新"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button><button type="button" onClick={handleExport} disabled={exporting || !response?.summary.totalFaults} className="flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:border-blue-300 hover:bg-blue-50 disabled:opacity-40" title="导出故障明细"><Download className="h-4 w-4" />{exporting ? '导出中' : '导出'}</button></div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 p-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{cards.map(({ label, value, detail, icon: Icon, tint }) => <div key={label} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm"><div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${tint}`}><Icon className="h-4 w-4" /></div><div className="min-w-0"><div className="truncate text-[11px] text-slate-500">{label}</div><div className="font-mono text-xl font-bold text-slate-800">{typeof value === 'number' ? value.toLocaleString() : value}</div><div className="truncate text-[11px] text-slate-400">{detail}</div></div></div>)}</div>
        <LRRFiltersPanel filters={filters} options={options} onChange={applyFilters} onReset={() => { setFilters(EMPTY_FILTERS); setPage(1); load(1, EMPTY_FILTERS); }} />
        <div className="flex items-center justify-between gap-3"><div className="relative w-full max-w-sm"><Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 PN 或物料描述" className="h-9 w-full rounded-md border border-slate-300 bg-white pl-8 pr-3 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200" /></div><span className="text-xs text-slate-400">{response ? `共 ${response.total.toLocaleString()} 种物料` : ''}</span></div>
        <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm"><div className="overflow-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600"><tr><th className="px-3 py-2">PN（MATNR后8位）</th><th className="px-3 py-2">物料描述</th><th className="cursor-pointer px-3 py-2" onClick={() => handleSort('issuedQuantity')}>发料数量 <SortIcon field="issuedQuantity" activeField={filters.sortBy ?? null} direction={filters.sortDir ?? 'desc'} /></th><th className="cursor-pointer px-3 py-2" onClick={() => handleSort('faultCount')}>故障件次 <SortIcon field="faultCount" activeField={filters.sortBy ?? null} direction={filters.sortDir ?? 'desc'} /></th><th className="cursor-pointer px-3 py-2" onClick={() => handleSort('lrrRate')}>LRR <SortIcon field="lrrRate" activeField={filters.sortBy ?? null} direction={filters.sortDir ?? 'desc'} /></th></tr></thead><tbody className="divide-y divide-slate-100 text-xs">{loading ? <tr><td colSpan={5} className="px-3 py-12 text-center text-slate-400">正在加载数据...</td></tr> : error ? <tr><td colSpan={5} className="px-3 py-12 text-center text-red-500">加载失败，请点击刷新重试</td></tr> : filteredData.length === 0 ? <tr><td colSpan={5} className="px-3 py-12 text-center text-slate-400">暂无符合条件的数据</td></tr> : filteredData.map((row) => { const color = lrrColor(row.lrrRate); return <tr key={row.id} className="hover:bg-slate-50"><td className="px-3 py-2 font-mono font-medium text-slate-700">{row.materialNo}</td><td className="px-3 py-2 text-slate-600">{row.materialDesc || '-'}</td><td className="px-3 py-2 font-mono">{row.issuedQuantity.toLocaleString()}</td><td className="px-3 py-2 font-mono">{row.faultCount ? <span className="font-semibold text-red-600">{row.faultCount.toLocaleString()}</span> : '0'}</td><td className="px-3 py-2"><div className="flex items-center gap-2"><div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${Math.min(100, (row.lrrRate ?? 0) * 4)}%`, backgroundColor: color.bar }} /></div><span className={`font-medium ${color.text}`}>{row.lrrRate == null ? '-' : `${row.lrrRate}%`}</span></div></td></tr>; })}</tbody></table></div></div>
        {response && response.total > 0 && <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500"><span>第 {page} / {totalPages} 页</span><div className="flex items-center gap-1"><button type="button" onClick={() => { setPage(page - 1); load(page - 1, filters); }} disabled={page <= 1} className="rounded border border-slate-200 p-1.5 disabled:opacity-40" title="上一页"><ChevronLeft className="h-3.5 w-3.5" /></button><button type="button" onClick={() => { setPage(page + 1); load(page + 1, filters); }} disabled={page >= totalPages} className="rounded border border-slate-200 p-1.5 disabled:opacity-40" title="下一页"><ChevronRight className="h-3.5 w-3.5" /></button></div></div>}
      </main>
    </div>
  );
}
