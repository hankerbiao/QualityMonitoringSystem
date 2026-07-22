import { Filter, RotateCcw, X } from 'lucide-react';
import type { LRRFilters, LRROptions, LRRTimeGranularity } from '../../types';

interface Props {
  filters: LRRFilters;
  options: LRROptions;
  onChange: (patch: Partial<LRRFilters>) => void;
  onReset: () => void;
}

const granularityOptions: { value: LRRTimeGranularity; label: string }[] = [
  { value: 'none', label: '不按时间' },
  { value: 'year', label: '按年' },
  { value: 'month', label: '按月' },
  { value: 'day', label: '按日' },
];

function Select({
  label,
  value,
  options,
  onChange,
  placeholder,
}: {
  label: string;
  value: string | null | undefined;
  options: string[] | undefined;
  onChange: (v: string | null) => void;
  placeholder: string;
}) {
  const opts = options ?? [];
  return (
    <label className="flex flex-col gap-1 text-[11px] text-slate-500">
      {label}
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="px-2 py-1.5 text-sm border border-slate-300 rounded-md bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
      >
        <option value="">{placeholder}</option>
        {opts.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function LRRFilters({ filters, options, onChange, onReset }: Props) {
  const hasActive =
    filters.factory ||
    filters.customer ||
    filters.productFamily ||
    filters.partType ||
    filters.partPN ||
    filters.faultType ||
    filters.dateFrom ||
    filters.dateTo ||
    (filters.timeGranularity && filters.timeGranularity !== 'none');

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-3">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <Filter className="w-4 h-4 text-blue-600" />
          多维筛选
        </div>
        <button
          onClick={onReset}
          disabled={!hasActive}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          重置
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2.5">
        <Select
          label="生产基地"
          value={filters.factory}
          options={options.factories}
          onChange={(v) => onChange({ factory: v })}
          placeholder="全部基地"
        />
        <Select
          label="客户"
          value={filters.customer}
          options={options.customers}
          onChange={(v) => onChange({ customer: v })}
          placeholder="全部客户"
        />
        <Select
          label="机型"
          value={filters.productFamily}
          options={options.productFamilies}
          onChange={(v) => onChange({ productFamily: v })}
          placeholder="全部机型"
        />
        <Select
          label="部件类型"
          value={filters.partType}
          options={options.partTypes}
          onChange={(v) => onChange({ partType: v })}
          placeholder="全部部件类型"
        />
        <Select
          label="故障类型"
          value={filters.faultType}
          options={options.faultTypes}
          onChange={(v) => onChange({ faultType: v })}
          placeholder="全部故障类型"
        />
        <label className="flex flex-col gap-1 text-[11px] text-slate-500">
          部件 PN
          <div className="relative">
            {filters.partPN ? (
              <button
                onClick={() => onChange({ partPN: null })}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                aria-label="清除"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : null}
            <input
              value={filters.partPN ?? ''}
              onChange={(e) => onChange({ partPN: e.target.value || null })}
              placeholder="输入部件PN"
              className="w-full pl-2 pr-7 py-1.5 text-sm border border-slate-300 rounded-md bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
            />
          </div>
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-slate-500">
          生产开始
          <input
            type="date"
            value={filters.dateFrom ?? ''}
            onChange={(e) => onChange({ dateFrom: e.target.value || null })}
            className="px-2 py-1.5 text-sm border border-slate-300 rounded-md bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-slate-500">
          生产结束
          <input
            type="date"
            value={filters.dateTo ?? ''}
            onChange={(e) => onChange({ dateTo: e.target.value || null })}
            className="px-2 py-1.5 text-sm border border-slate-300 rounded-md bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-slate-500">
          时间趋势粒度
          <select
            value={filters.timeGranularity ?? 'none'}
            onChange={(e) => onChange({ timeGranularity: e.target.value as LRRTimeGranularity })}
            className="px-2 py-1.5 text-sm border border-slate-300 rounded-md bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
          >
            {granularityOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
