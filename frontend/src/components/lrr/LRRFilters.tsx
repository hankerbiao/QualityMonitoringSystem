import { Filter, RotateCcw } from 'lucide-react';
import type { LRRFilters, LRROptions } from '../../types';

interface Props {
  filters: LRRFilters;
  options: LRROptions;
  onChange: (patch: Partial<LRRFilters>) => void;
  onReset: () => void;
}

function Select({ label, value, options, onChange, placeholder }: {
  label: string;
  value: string | null | undefined;
  options: string[];
  onChange: (value: string | null) => void;
  placeholder: string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[11px] text-slate-500">
      {label}
      <select value={value ?? ''} onChange={(event) => onChange(event.target.value || null)} className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200">
        <option value="">{placeholder}</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

export default function LRRFilters({ filters, options, onChange, onReset }: Props) {
  const hasActive = Boolean(filters.productionOrder || filters.salesOrder || filters.storageLocation);
  const productionOrders = Array.isArray(options?.productionOrders) ? options.productionOrders : [];
  const salesOrders = Array.isArray(options?.salesOrders) ? options.salesOrders : [];
  const storageLocations = Array.isArray(options?.storageLocations) ? options.storageLocations : [];
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-700"><Filter className="h-4 w-4 text-blue-600" />订单 BOM 筛选</div>
        <button type="button" onClick={onReset} disabled={!hasActive} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw className="h-3 w-3" />重置</button>
      </div>
      <div className="mb-3 flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-1" role="group" aria-label="LRR 统计维度">
        <button type="button" onClick={() => onChange({ groupBy: 'productionOrder' })} className={`h-7 rounded px-3 text-xs font-medium ${filters.groupBy !== 'salesOrder' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>生产订单</button>
        <button type="button" onClick={() => onChange({ groupBy: 'salesOrder' })} className={`h-7 rounded px-3 text-xs font-medium ${filters.groupBy === 'salesOrder' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>销售订单</button>
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex min-w-0 flex-col gap-1 text-[11px] text-slate-500">
          生产订单
          <input value={filters.productionOrder ?? ''} onChange={(event) => onChange({ productionOrder: event.target.value || null })} placeholder="输入或选择生产订单" list="lrr-production-orders" className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200" />
          <datalist id="lrr-production-orders">{productionOrders.map((option) => <option key={option} value={option} />)}</datalist>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-[11px] text-slate-500">
          销售订单
          <input value={filters.salesOrder ?? ''} onChange={(event) => onChange({ salesOrder: event.target.value || null })} placeholder="输入或选择销售订单" list="lrr-sales-orders" className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200" />
          <datalist id="lrr-sales-orders">{salesOrders.map((option) => <option key={option} value={option} />)}</datalist>
        </label>
        <Select label="库存点" value={filters.storageLocation} options={storageLocations} onChange={(value) => onChange({ storageLocation: value })} placeholder="全部库存点" />
      </div>
    </div>
  );
}
