import { useEffect, useRef, useState } from 'react';
import { ChevronDown, RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import { lrrApi } from '../../api/lrrApi';
import type { LRRFilters, LRROptions } from '../../types';

interface Props {
  filters: LRRFilters;
  onSearch: (nextFilters: LRRFilters) => void;
  onReset: () => void;
}

const EMPTY_DRAFT: LRRFilters = { sortBy: 'lrrRate', sortDir: 'desc' };

interface SearchableSelectProps {
  value: string | null | undefined;
  options: string[];
  allLabel: string;
  onChange: (value: string | null) => void;
}

function SearchableSelect({ value, options, allLabel, onChange }: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const filteredOptions = options.filter((option) => option.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((current) => !current);
          setQuery('');
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-3 text-left text-sm text-slate-700 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
      >
        <span className="truncate">{value || allLabel}</span>
        <ChevronDown className={`size-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg shadow-slate-900/10">
          <div className="border-b border-slate-100 p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }}
                placeholder={`搜索${allLabel.replace('全部', '')}`}
                autoFocus
                className="h-8 w-full rounded-md border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-cyan-500 focus:bg-white focus:ring-2 focus:ring-cyan-100"
              />
            </div>
          </div>
          <div role="listbox" className="max-h-60 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => { onChange(null); setOpen(false); }}
              className={`w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-cyan-50 ${!value ? 'bg-cyan-50 font-medium text-cyan-800' : 'text-slate-600'}`}
            >
              {allLabel}
            </button>
            {filteredOptions.length > 0 ? filteredOptions.map((option) => (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={value === option}
                onClick={() => { onChange(option); setOpen(false); }}
                className={`w-full px-3 py-1.5 text-left font-mono text-xs transition-colors hover:bg-cyan-50 ${value === option ? 'bg-cyan-50 font-medium text-cyan-800' : 'text-slate-600'}`}
              >
                <span className="block truncate">{option}</span>
              </button>
            )) : <p className="px-3 py-3 text-xs text-slate-400">无匹配选项</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LRRFilters({ filters, onSearch, onReset }: Props) {
  const [options, setOptions] = useState<LRROptions>({ materialNumbers: [], bases: [], customerIds: [] });
  const [draft, setDraft] = useState<LRRFilters>(filters);

  useEffect(() => { lrrApi.getOptions().then(setOptions).catch(() => undefined); }, []);
  useEffect(() => setDraft(filters), [filters]);

  const activeKeys = ['materialNumber', 'base', 'customerId', 'ngDateFrom', 'ngDateTo'] as const;
  const hasActive = activeKeys.some((key) => Boolean(draft[key] || filters[key]));
  const hasPendingChanges = activeKeys.some((key) => (draft[key] || null) !== (filters[key] || null));
  const inputClass = 'h-10 min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100';
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
    <section className="border-y border-slate-100 bg-slate-50/70 px-4 py-5 sm:px-5 lg:px-6">
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-x-5 lg:gap-y-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 lg:col-span-12"><SlidersHorizontal className="size-4 text-cyan-700" />筛选条件</div>

        <div className="flex min-w-0 flex-col gap-2 lg:col-span-5"><span className="text-xs font-semibold text-slate-600">NG 时间</span><div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2"><input type="date" value={draft.ngDateFrom ?? ''} max={draft.ngDateTo ?? undefined} onChange={(e) => setFilter('ngDateFrom', e.target.value || null)} aria-label="NG 开始时间" className={`${inputClass} w-full`} /><span className="text-xs text-slate-400">至</span><input type="date" value={draft.ngDateTo ?? ''} min={draft.ngDateFrom ?? undefined} onChange={(e) => setFilter('ngDateTo', e.target.value || null)} aria-label="NG 结束时间" className={`${inputClass} w-full`} /></div></div>
        <div className="flex min-w-0 flex-col gap-2 lg:col-span-5"><span className="text-xs font-semibold text-slate-400">计划开始时间 <span className="font-normal">（待数据接入）</span></span><div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2"><input type="date" disabled aria-label="计划开始时间起始日" className={`${inputClass} w-full cursor-not-allowed bg-slate-100 text-slate-400`} /><span className="text-xs text-slate-300">至</span><input type="date" disabled aria-label="计划开始时间截止日" className={`${inputClass} w-full cursor-not-allowed bg-slate-100 text-slate-400`} /></div></div>
        <div className="flex items-end gap-2 lg:col-span-2"><div className="flex flex-1 flex-col gap-1"><span aria-live="polite" className={`text-xs text-amber-700 ${hasPendingChanges ? '' : 'invisible'}`}>筛选条件尚未应用</span><button type="submit" className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-cyan-600 px-3 text-sm font-medium text-white hover:bg-cyan-700"><Search className="size-4" />查询</button></div><button type="button" onClick={reset} disabled={!hasActive} className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" title="重置筛选" aria-label="重置筛选"><RotateCcw className="size-4" /></button></div>

        <label className="flex min-w-0 flex-col gap-2 lg:col-span-4"><span className="text-xs font-semibold text-slate-600">物料号</span><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input type="search" value={draft.materialNumber ?? ''} onChange={(e) => setFilter('materialNumber', e.target.value)} placeholder="输入 8 位或完整物料号" className={`${inputClass} w-full pl-9`} /></div></label>
        <div className="flex min-w-0 flex-col gap-2 lg:col-span-3"><span className="text-xs font-semibold text-slate-600">基地</span><SearchableSelect value={draft.base} options={options.bases} allLabel="全部基地" onChange={(value) => setFilter('base', value)} /></div>
        <div className="flex min-w-0 flex-col gap-2 lg:col-span-3"><span className="text-xs font-semibold text-slate-600">客户 ID</span><SearchableSelect value={draft.customerId} options={options.customerIds} allLabel="全部客户" onChange={(value) => setFilter('customerId', value)} /></div>
      </form>
    </section>
  );
}
