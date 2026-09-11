import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Database,
  FileSearch,
  LoaderCircle,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react';
import { metadataApi } from '../api/metadataApi';
import type { MetadataTableResponse } from '../types/metadata';

const PAGE_SIZE = 25;
const FILTER_KEYS = [
  'productionOrder', 'salesOrder', 'productModel', 'serviceNumber', 'serialNumber', 'customer',
  'product', 'doaType', 'judgment', 'processingStatus', 'acceptedDateFrom',
  'acceptedDateTo',
] as const;

function getInitialFilters(search: string): Record<string, string> {
  const params = new URLSearchParams(search);
  return Object.fromEntries(
    FILTER_KEYS.map((key) => [key, params.get(key)?.trim() || '']),
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function getPathValue(row: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, part) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[part];
  }, row);
}

function DetailModal({ row, onClose }: { row: Record<string, unknown>; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-md border border-slate-200 bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-800">完整记录</h2>
          <button type="button" onClick={onClose} className="flex size-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-700" aria-label="关闭详情">
            <XCircle className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {Object.entries(row).map(([key, value]) => (
              <div key={key} className="min-w-0 border-b border-slate-100 pb-2">
                <dt className="font-mono text-[11px] text-slate-400">{key}</dt>
                <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">{displayValue(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}

export default function MetadataTablePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { tableName = '' } = useParams<{ tableName: string }>();
  const returnTo = location.state?.returnTo === '/mfr' ? '/mfr' : '/';
  const returnLabel = returnTo === '/mfr' ? '返回 MFR' : '返回首页';
  const initialSearch = useMemo(() => new URLSearchParams(location.search).get('search')?.trim() || '', [location.search]);
  const initialFilters = useMemo(() => getInitialFilters(location.search), [location.search]);
  const [data, setData] = useState<MetadataTableResponse | null>(null);
  const [page, setPage] = useState(1);
  const [draftSearch, setDraftSearch] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [draftFilters, setDraftFilters] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async (
    targetPage: number,
    targetSearch: string,
    targetFilters: Record<string, string>,
  ) => {
    setLoading(true);
    setError('');
    try {
      const result = await metadataApi.getTable(
        tableName,
        targetPage,
        PAGE_SIZE,
        targetSearch,
        targetFilters,
      );
      setData(result);
      setPage(result.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : '表数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [tableName]);

  useEffect(() => {
    setData(null);
    setPage(1);
    setDraftSearch(initialSearch);
    setSearch(initialSearch);
    setDraftFilters(initialFilters);
    setFilters(initialFilters);
    void load(1, initialSearch, initialFilters);
  }, [load, initialFilters, initialSearch]);

  const visibleColumns = data?.columns || [];

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const nextSearch = draftSearch.trim();
    const nextFilters = Object.fromEntries(
      Object.entries(draftFilters).map(([key, value]) => [key, value.trim()]),
    );
    setSearch(nextSearch);
    setFilters(nextFilters);
    void load(1, nextSearch, nextFilters);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={() => navigate(returnTo)} className="flex size-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800" title={returnLabel} aria-label={returnLabel}>
              <ArrowLeft className="size-4" />
            </button>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white"><Database className="size-5" /></span>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-slate-900">{data?.title || '元数据表'}</h1>
              <p className="truncate font-mono text-xs text-slate-400">{tableName}</p>
            </div>
          </div>
          <button type="button" onClick={() => load(page, search, filters)} disabled={loading} className="flex size-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50" title="刷新数据" aria-label="刷新数据">
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1800px] space-y-4 px-4 py-5 sm:px-6 lg:px-8">
        {loading && !data ? (
          <div className="flex min-h-[420px] items-center justify-center rounded-md border border-slate-200 bg-white text-sm text-slate-500"><LoaderCircle className="mr-2 size-4 animate-spin" />正在加载表数据</div>
        ) : error && !data ? (
          <div className="flex min-h-[420px] flex-col items-center justify-center rounded-md border border-slate-200 bg-white text-center"><XCircle className="mb-3 size-8 text-rose-300" /><p className="text-sm font-medium text-slate-700">{error}</p><button type="button" onClick={() => load(page, search, filters)} className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">重新加载</button></div>
        ) : data ? (
          <>
            <section className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white px-5 py-4">
              <div className="min-w-0"><p className="text-sm text-slate-600">{data.description}</p><p className="mt-1 text-xs text-slate-400">共 {formatNumber(data.total)} 条记录 · 展示关键字段，点击行查看完整原始记录</p></div>
              <form onSubmit={submitSearch} className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                {data.filters.map((filter) => <label key={filter.key} className="flex min-w-0 flex-col gap-1"><span className="text-[11px] font-medium text-slate-500">{filter.label}</span><input type={filter.inputType || 'text'} value={draftFilters[filter.key] || ''} onChange={(event) => setDraftFilters((current) => ({ ...current, [filter.key]: event.target.value }))} placeholder={filter.inputType === 'date' ? undefined : `搜索${filter.label}`} className="h-9 min-w-0 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15" /></label>)}
                <div className="relative min-w-0 self-end"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder="搜索关键字段" className="h-9 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15" /></div>
                <button type="submit" className="h-9 self-end rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-700">搜索</button>
              </form>
            </section>
            {error && <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">刷新失败，当前展示上一次成功获取的数据。</div>}
            <section className="relative overflow-hidden rounded-md border border-slate-200 bg-white">
              {loading && <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/65 backdrop-blur-[1px]"><div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm"><LoaderCircle className="size-4 animate-spin" />正在刷新</div></div>}
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="text-sm font-semibold text-slate-800">数据明细</h2><p className="mt-1 text-xs text-slate-400">{search || Object.values(filters).some(Boolean) ? '已应用搜索条件' : '按数据库记录顺序展示'}</p></div><FileSearch className="size-4 text-slate-400" /></div>
              {data.rows.length === 0 ? <div className="px-5 py-16 text-center text-sm text-slate-400">暂无匹配数据</div> : <div className="overflow-x-auto"><table className="w-full min-w-[1200px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-400"><tr>{visibleColumns.map((column) => <th key={column.key} className="whitespace-nowrap px-4 py-2.5 font-medium">{column.label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{data.rows.map((row, index) => <tr key={String(row._source_key || row._id || index)} onClick={() => setSelectedRow(row)} className="cursor-pointer text-slate-600 hover:bg-blue-50/40">{visibleColumns.map((column) => <td key={column.key} className="max-w-[240px] truncate whitespace-nowrap px-4 py-3" title={displayValue(getPathValue(row, column.key))}>{displayValue(getPathValue(row, column.key))}</td>)}</tr>)}</tbody></table></div>}
              <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3"><span className="text-xs text-slate-400">第 {data.page} 页 · 共 {formatNumber(data.total)} 条</span><div className="flex items-center gap-2"><button type="button" onClick={() => load(page - 1, search, filters)} disabled={loading || page <= 1} className="flex size-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40" title="上一页" aria-label="上一页"><ChevronLeft className="size-4" /></button><button type="button" onClick={() => load(page + 1, search, filters)} disabled={loading || !data.has_more} className="flex size-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40" title="下一页" aria-label="下一页"><ChevronRight className="size-4" /></button></div></div>
            </section>
          </>
        ) : null}
      </main>
      {selectedRow && <DetailModal row={selectedRow} onClose={() => setSelectedRow(null)} />}
    </div>
  );
}
