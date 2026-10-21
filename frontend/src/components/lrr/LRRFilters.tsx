import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import { lrrApi } from '../../api/lrrApi';
import { ApiRequestError } from '../../api/authApi';
import { MonthQuickPicker } from '../shared/MonthQuickPicker';
import type { LRRFilters, LRROptions } from '../../types';
import { exceedsTwoCalendarMonths, matchingPlannedRange, recentPlannedRange } from '../../utils/lrr';
import { customerIdLabel, NO_CUSTOMER_ID } from '../../utils/customerId';

interface Props {
  filters: LRRFilters;
  onSearch: (nextFilters: LRRFilters) => void;
  onReset: () => void;
}

const EMPTY_DRAFT: LRRFilters = { sortBy: 'month', sortDir: 'asc' };
const FILTER_FIELDS = ['materialNumber', 'productModels', 'bases', 'customerIds', 'plannedDateFrom', 'plannedDateTo'] as const;

interface SearchableSelectProps {
  value: string | string[] | null | undefined;
  options: string[];
  allLabel: string;
  onChange: (value: string | string[] | null) => void;
  multiple?: boolean;
}

function SearchableSelect({ value, options, allLabel, onChange, multiple = false, customerIds = false }: SearchableSelectProps & { customerIds?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedValues = Array.isArray(value) ? value : value ? [value] : [];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredOptions = options.filter((option) => option.toLocaleLowerCase().includes(normalizedQuery));
  const displayOptions = customerIds
    ? [
        ...(customerIdLabel(NO_CUSTOMER_ID).toLocaleLowerCase().includes(normalizedQuery) ? [NO_CUSTOMER_ID] : []),
        ...filteredOptions.filter((option) => option !== NO_CUSTOMER_ID),
      ]
    : filteredOptions;
  const buttonLabel = selectedValues.length === 0
    ? allLabel
    : multiple && selectedValues.length > 1
    ? `已选 ${selectedValues.length} 个`
      : customerIds ? customerIdLabel(selectedValues[0]) : selectedValues[0];

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
        <span className="truncate">{buttonLabel}</span>
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
          <div role="listbox" aria-multiselectable={multiple} className="max-h-60 overflow-y-auto py-1">
            {multiple && (
              <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5 text-xs">
                <button type="button" onClick={() => onChange(customerIds ? [NO_CUSTOMER_ID, ...options.filter((option) => option !== NO_CUSTOMER_ID)] : options)} className="font-medium text-cyan-700 hover:text-cyan-800">全选</button>
                <button type="button" onClick={() => onChange([])} className="text-slate-500 hover:text-slate-700">清空</button>
              </div>
            )}
            <button
              type="button"
              onClick={() => { onChange(null); if (!multiple) setOpen(false); }}
              className={`w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-cyan-50 ${selectedValues.length === 0 ? 'bg-cyan-50 font-medium text-cyan-800' : 'text-slate-600'}`}
            >
              {allLabel}
            </button>
            {displayOptions.length > 0 ? displayOptions.map((option) => (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={selectedValues.includes(option)}
                onClick={() => {
                  if (!multiple) {
                    onChange(option);
                    setOpen(false);
                    return;
                  }
                  onChange(selectedValues.includes(option)
                    ? selectedValues.filter((selected) => selected !== option)
                    : [...selectedValues, option]);
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs transition-colors hover:bg-cyan-50 ${selectedValues.includes(option) ? 'bg-cyan-50 font-medium text-cyan-800' : 'text-slate-600'}`}
              >
                {multiple && <span className={`flex size-3.5 shrink-0 items-center justify-center rounded-sm border ${selectedValues.includes(option) ? 'border-cyan-600 bg-cyan-600 text-white' : 'border-slate-300'}`}>{selectedValues.includes(option) && <Check className="size-3" />}</span>}
                <span className="block truncate">{customerIds ? customerIdLabel(option) : option}</span>
              </button>
            )) : <p className="px-3 py-3 text-xs text-slate-400">无匹配选项</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LRRFilters({ filters, onSearch, onReset }: Props) {
  const [options, setOptions] = useState<LRROptions>({ materialNumbers: [], productModels: [], bases: [], customerIds: [] });
  const [optionsError, setOptionsError] = useState<ApiRequestError | null>(null);
  const [draft, setDraft] = useState<LRRFilters>(filters);

  const loadOptions = useCallback(async () => {
    setOptionsError(null);
    try {
      setOptions(await lrrApi.getOptions());
    } catch (error) {
      setOptionsError(error instanceof ApiRequestError ? error : new ApiRequestError('筛选选项加载失败，请重试', { code: 'OPTIONS_LOAD_FAILED', retryable: true }));
    }
  }, []);

  useEffect(() => { void loadOptions(); }, [loadOptions]);
  useEffect(() => setDraft(filters), [filters]);

  const normalizedValue = (value: LRRFilters[typeof FILTER_FIELDS[number]]) => Array.isArray(value) ? value.join('\u0000') : value || '';
  const hasActive = FILTER_FIELDS.some((key) => Boolean(normalizedValue(draft[key])));
  const activeCount = FILTER_FIELDS.filter((key) => Boolean(normalizedValue(draft[key]))).length;
  const hasPendingChanges = FILTER_FIELDS.some((key) => normalizedValue(draft[key]) !== normalizedValue(filters[key]));
  const hasScopeFilter = Boolean(
    draft.materialNumber?.trim()
    || draft.productModels?.some((value) => value.trim())
    || draft.bases?.some((value) => value.trim())
    || draft.customerIds?.some((value) => value.trim()),
  );
  const bomScopeWarning = hasActive
    && !draft.materialNumber?.trim()
    && !draft.plannedDateFrom
    && !draft.plannedDateTo
    ? '请至少选择计划日期范围或物料 PN'
    : '';
  const scopeFilterWarning = exceedsTwoCalendarMonths(draft.plannedDateFrom, draft.plannedDateTo)
    && !hasScopeFilter
    ? '查询周期超过 2 个月，请至少增加物料号、机型、基地或客户 ID 筛选条件'
    : '';
  const inputClass = 'h-10 min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100';
  const setFilter = <K extends keyof LRRFilters>(key: K, value: LRRFilters[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (scopeFilterWarning || bomScopeWarning) return;
    onSearch({ ...draft, materialNumber: draft.materialNumber?.trim() || null });
  };
  const reset = () => {
    setDraft(EMPTY_DRAFT);
    onReset();
  };

  return (
    <section className="bg-slate-50/70 px-4 py-4 sm:px-5 lg:px-6">
      {optionsError && <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-2 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"><span>{optionsError.message || '筛选选项加载失败，请重试'}</span><button type="button" onClick={() => void loadOptions()} className="inline-flex items-center gap-1 font-medium hover:underline"><RotateCcw className="size-3.5" />重试</button></div>}
      {(scopeFilterWarning || bomScopeWarning) && <p role="alert" className="mb-4 border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{scopeFilterWarning || bomScopeWarning}</p>}
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-x-5 lg:gap-y-4">
        <div className="flex min-h-5 items-center justify-between gap-3 lg:col-span-12">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><SlidersHorizontal className="size-4 text-cyan-700" />筛选条件</div>
          <div className="flex flex-wrap items-center justify-end gap-2 text-xs" aria-live="polite">
            <div className="flex flex-wrap gap-1">
              {([1, 2, 3, 12] as const).map((months) => {
                const active = matchingPlannedRange(draft.plannedDateFrom, draft.plannedDateTo) === months;
                return (
                  <button
                    key={months}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      const range = recentPlannedRange(months);
                      const next = { ...draft, ...range, materialNumber: draft.materialNumber?.trim() || null };
                      setDraft(next);
                      if (months > 2 && !hasScopeFilter) return;
                      onSearch(next);
                    }}
                    className={`h-8 rounded-md border px-2.5 ${active ? 'border-cyan-700 bg-cyan-700 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}
                  >
                    {months === 1 ? '本月' : months === 12 ? '近一年' : `近${months}个月`}
                  </button>
                );
              })}
            </div>
            {activeCount > 0 && <span className="font-medium text-slate-500">已选 {activeCount} 项</span>}
            <span className={hasPendingChanges ? 'font-medium text-amber-700' : 'hidden'}>条件尚未查询</span>
          </div>
        </div>

        {/* 故障时间跟随维修记录计划生产时间 GSTRS，和物料计划开始时间使用同一周期。 */}
        <div className="flex min-w-0 flex-col gap-2 lg:col-span-6">
          <span className="text-xs font-semibold text-slate-600">计划开始时间（GSTRS）</span>
          <div className="overflow-hidden rounded-md border border-slate-300 bg-white focus-within:border-cyan-500 focus-within:ring-2 focus-within:ring-cyan-100">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch">
              <input type="date" value={draft.plannedDateFrom ?? ''} max={draft.plannedDateTo ?? undefined} onChange={(e) => setFilter('plannedDateFrom', e.target.value || null)} aria-label="计划开始时间起始日" className="h-10 min-w-0 border-0 bg-transparent px-3 text-sm text-slate-700 outline-none" />
              <span className="flex items-center border-x border-slate-200 px-2.5 text-xs text-slate-400">至</span>
              <input type="date" value={draft.plannedDateTo ?? ''} min={draft.plannedDateFrom ?? undefined} onChange={(e) => setFilter('plannedDateTo', e.target.value || null)} aria-label="计划开始时间截止日" className="h-10 min-w-0 border-0 bg-transparent px-3 text-sm text-slate-700 outline-none" />
            </div>
            <div className="border-t border-slate-100 px-3 py-2">
              <MonthQuickPicker from={draft.plannedDateFrom ?? ''} to={draft.plannedDateTo ?? ''} onChange={(from, to) => setDraft((current) => ({ ...current, plannedDateFrom: from, plannedDateTo: to }))} accent="cyan" defaultExpanded={false} />
            </div>
          </div>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_auto] lg:col-span-6 lg:self-start lg:gap-3">
          <label className="flex min-w-0 flex-col gap-2"><span className="text-xs font-semibold text-slate-600">物料号</span><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><input type="search" value={draft.materialNumber ?? ''} onChange={(e) => setFilter('materialNumber', e.target.value)} placeholder="输入 8 位或完整物料号" className={`${inputClass} w-full pl-9`} /></div></label>
          <div className="flex items-end gap-2">
            <button type="submit" className="inline-flex h-10 min-w-28 items-center justify-center gap-1.5 rounded-md bg-cyan-600 px-4 text-sm font-medium text-white transition-colors hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-cyan-300 focus:ring-offset-2"><Search className="size-4" />查询</button>
            <button type="button" onClick={reset} disabled={!hasActive} className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-cyan-200 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40" title="重置筛选" aria-label="重置筛选"><RotateCcw className="size-4" /></button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 border-t border-slate-200 pt-4 sm:grid-cols-3 lg:col-span-12 lg:gap-5"><div className="flex min-w-0 flex-col gap-2"><span className="text-xs font-semibold text-slate-600">机型</span><SearchableSelect value={draft.productModels} options={options.productModels} allLabel="全部机型" multiple onChange={(value) => setFilter('productModels', (value as string[] | null) ?? undefined)} /></div><div className="flex min-w-0 flex-col gap-2"><span className="text-xs font-semibold text-slate-600">基地</span><SearchableSelect value={draft.bases} options={options.bases} allLabel="全部基地" multiple onChange={(value) => setFilter('bases', (value as string[] | null) ?? undefined)} /></div><div className="flex min-w-0 flex-col gap-2"><span className="text-xs font-semibold text-slate-600">客户 ID</span><SearchableSelect value={draft.customerIds} options={options.customerIds} allLabel="全部客户" multiple customerIds onChange={(value) => setFilter('customerIds', (value as string[] | null) ?? undefined)} /></div></div>
      </form>
      {scopeFilterWarning && <div role="alert" className="border-t border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 sm:px-5 lg:px-6">{scopeFilterWarning}</div>}
    </section>
  );
}
