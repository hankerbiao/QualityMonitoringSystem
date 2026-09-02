import { useEffect, useState } from 'react';
import { Filter, RotateCcw, Search } from 'lucide-react';
import { lrrApi } from '../../api/lrrApi';
import type { LRRFilters, LRROptions } from '../../types';

interface Props {
  filters: LRRFilters;
  onChange: (patch: Partial<LRRFilters>) => void;
  onReset: () => void;
}

export default function LRRFilters({ filters, onChange, onReset }: Props) {
  const [options, setOptions] = useState<LRROptions>({ materialNumbers: [], bases: [], customerIds: [] });
  const [materialDraft, setMaterialDraft] = useState(filters.materialNumber ?? '');

  useEffect(() => { lrrApi.getOptions().then(setOptions).catch(() => undefined); }, []);
  useEffect(() => setMaterialDraft(filters.materialNumber ?? ''), [filters.materialNumber]);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const value = materialDraft.trim() || null;
      if (value !== (filters.materialNumber ?? null)) onChange({ materialNumber: value });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [materialDraft, filters.materialNumber, onChange]);

  const hasActive = Boolean(filters.materialNumber || filters.base || filters.customerId || filters.month || filters.dateFrom || filters.dateTo);
  const inputClass = 'h-9 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-200';

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Filter className="size-4 text-blue-600" />LRR 数据筛选</div>
        <button type="button" onClick={onReset} disabled={!hasActive} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw className="size-3.5" />重置</button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">统计月份<input type="month" value={filters.month ?? ''} onChange={(e) => onChange({ month: e.target.value || null })} className={inputClass} /></label>
        <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">开始日期<input type="date" value={filters.dateFrom ?? ''} max={filters.dateTo ?? undefined} onChange={(e) => onChange({ dateFrom: e.target.value || null })} className={inputClass} /></label>
        <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">结束日期<input type="date" value={filters.dateTo ?? ''} min={filters.dateFrom ?? undefined} onChange={(e) => onChange({ dateTo: e.target.value || null })} className={inputClass} /></label>
        <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">物料号搜索<div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input type="search" value={materialDraft} onChange={(e) => setMaterialDraft(e.target.value)} placeholder="输入物料号" className={`${inputClass} w-full pl-8`} /></div></label>
        <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">生产订单基地<select value={filters.base ?? ''} onChange={(e) => onChange({ base: e.target.value || null })} className={inputClass}><option value="">全部基地</option>{options.bases.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-500">客户 ID<select value={filters.customerId ?? ''} onChange={(e) => onChange({ customerId: e.target.value || null })} className={inputClass}><option value="">全部客户</option>{options.customerIds.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      </div>
    </section>
  );
}
