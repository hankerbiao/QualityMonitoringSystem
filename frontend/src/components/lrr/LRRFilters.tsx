import { useEffect, useState } from 'react';
import { RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import { lrrApi } from '../../api/lrrApi';
import type { LRRFilters, LRROptions } from '../../types';

interface Props {
  filters: LRRFilters;
  onSearch: (nextFilters: LRRFilters) => void;
  onReset: () => void;
}

const EMPTY_DRAFT: LRRFilters = { sortBy: 'lrrRate', sortDir: 'desc' };

export default function LRRFilters({ filters, onSearch, onReset }: Props) {
  const [options, setOptions] = useState<LRROptions>({ materialNumbers: [], bases: [], customerIds: [] });
  const [draft, setDraft] = useState<LRRFilters>(filters);

  useEffect(() => { lrrApi.getOptions().then(setOptions).catch(() => undefined); }, []);
  useEffect(() => setDraft(filters), [filters]);

  const activeKeys = ['materialNumber', 'base', 'customerId', 'month', 'dateFrom', 'dateTo'] as const;
  const hasActive = activeKeys.some((key) => Boolean(draft[key] || filters[key]));
  const hasPendingChanges = activeKeys.some((key) => (draft[key] || null) !== (filters[key] || null));
  const inputClass = 'h-9 min-w-0 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100';
  const setFilter = <K extends keyof LRRFilters>(key: K, value: LRRFilters[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSearch({ ...draft, materialNumber: draft.materialNumber?.trim() || null });
  };
  const reset = () => {
    setDraft(EMPTY_DRAFT);
    onReset();
  };

  return (
    <section className="border-y border-slate-100 bg-slate-50/70 px-4 py-3 sm:px-5">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <div className="mr-1 flex h-9 items-center gap-2 text-sm font-semibold text-slate-800"><SlidersHorizontal className="size-4 text-cyan-700" />筛选条件</div>
        <label className="flex min-w-[132px] flex-1 flex-col gap-1 text-[11px] font-medium text-slate-500 sm:max-w-[152px]">统计月份<input type="month" value={draft.month ?? ''} onChange={(e) => setFilter('month', e.target.value || null)} className={inputClass} /></label>
        <label className="flex min-w-[132px] flex-1 flex-col gap-1 text-[11px] font-medium text-slate-500 sm:max-w-[152px]">开始日期<input type="date" value={draft.dateFrom ?? ''} max={draft.dateTo ?? undefined} onChange={(e) => setFilter('dateFrom', e.target.value || null)} className={inputClass} /></label>
        <label className="flex min-w-[132px] flex-1 flex-col gap-1 text-[11px] font-medium text-slate-500 sm:max-w-[152px]">结束日期<input type="date" value={draft.dateTo ?? ''} min={draft.dateFrom ?? undefined} onChange={(e) => setFilter('dateTo', e.target.value || null)} className={inputClass} /></label>
        <label className="flex min-w-[150px] flex-[1.3] flex-col gap-1 text-[11px] font-medium text-slate-500 sm:max-w-[210px]">物料号<div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input type="search" value={draft.materialNumber ?? ''} onChange={(e) => setFilter('materialNumber', e.target.value)} placeholder="输入物料号" className={`${inputClass} w-full pl-8`} /></div></label>
        <label className="flex min-w-[132px] flex-1 flex-col gap-1 text-[11px] font-medium text-slate-500 sm:max-w-[152px]">生产订单基地<select value={draft.base ?? ''} onChange={(e) => setFilter('base', e.target.value || null)} className={inputClass}><option value="">全部基地</option>{options.bases.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="flex min-w-[132px] flex-1 flex-col gap-1 text-[11px] font-medium text-slate-500 sm:max-w-[152px]">客户 ID<select value={draft.customerId ?? ''} onChange={(e) => setFilter('customerId', e.target.value || null)} className={inputClass}><option value="">全部客户</option>{options.customerIds.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <div className="flex h-9 items-center gap-1.5">
          <button type="submit" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-cyan-600 px-3 text-sm font-medium text-white hover:bg-cyan-700"><Search className="size-4" />查询</button>
          <button type="button" onClick={reset} disabled={!hasActive} className="inline-flex size-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" title="重置筛选" aria-label="重置筛选"><RotateCcw className="size-4" /></button>
        </div>
        {hasPendingChanges && <span className="pb-2 text-xs text-amber-700">筛选条件尚未应用</span>}
      </form>
    </section>
  );
}
