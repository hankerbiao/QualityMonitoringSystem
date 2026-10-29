import { useId, useState } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';

export type AdvancedFilterText = { serialNumbers: string; productionOrders: string; salesOrders: string };
export const EMPTY_ADVANCED_FILTERS: AdvancedFilterText = { serialNumbers: '', productionOrders: '', salesOrders: '' };
export function parseAdvancedFilters(value: AdvancedFilterText) {
  const split = (text: string) => [...new Set(text.split(/\r?\n/).map(item => item.trim()).filter(Boolean))];
  return { serialNumbers: split(value.serialNumbers), productionOrders: split(value.productionOrders), salesOrders: split(value.salesOrders) };
}

export function advancedQuery(value: AdvancedFilterText) {
  const parsed = parseAdvancedFilters(value);
  return Object.fromEntries(Object.entries(parsed).filter(([, items]) => items.length)) as Partial<Record<keyof AdvancedFilterText, string[]>>;
}

export function AdvancedFilters({ value, onChange }: { value: AdvancedFilterText; onChange: (next: AdvancedFilterText) => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const count = Object.values(parseAdvancedFilters(value)).reduce((sum, items) => sum + items.length, 0);
  return <div className="w-full basis-full">
    <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(current => !current)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500">
      <SlidersHorizontal className="size-3.5" />高级筛选{count > 0 && <span className="text-cyan-700">({count})</span>}<ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div id={id} className="mt-3 rounded-md border border-slate-200 bg-white p-3">
      <p className="mb-3 text-xs text-slate-500">每行输入一个，字段之间同时满足；留空表示不限制。按 SN 筛选时，订单和发料数量按关联订单统计。</p>
      <div className="grid gap-3 sm:grid-cols-3">{([['serialNumbers', 'SN'], ['productionOrders', '生产订单'], ['salesOrders', '销售订单']] as const).map(([key, label]) => <label key={key} className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-slate-600">{label}<textarea rows={3} value={value[key]} onChange={event => onChange({ ...value, [key]: event.target.value })} placeholder="每行一个" className="w-full resize-y rounded-md border border-slate-300 px-2.5 py-2 font-mono text-sm text-slate-800 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100" /></label>)}</div>
    </div>}
  </div>;
}
