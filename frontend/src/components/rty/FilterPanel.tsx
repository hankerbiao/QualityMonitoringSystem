import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { BarChart3, CalendarDays, ChevronDown, Download, RotateCcw, Search, X } from 'lucide-react';
import { rtyApi } from '../../api/rtyApi';
import type { RTYFilterParams } from '../../types';
import { MonthQuickPicker } from '../shared/MonthQuickPicker';
import { HelpTooltip } from '../shared/HelpTooltip';
import { customerIdLabel, NO_CUSTOMER_ID } from '../../utils/customerId';

const COMPOSITE_MODELS = new Set(['6210 C21 BOX', '6215 C32']);

const EMPTY_FILTERS: RTYFilterParams = {
  dateRange: { from: undefined, to: undefined },
  productModel: 'all',
  productModels: [],
  customer: '',
  base: 'all',
  bases: [],
  customers: [],
  salesOrder: '',
  productionOrder: '',
  serialNumber: '',
  orderScope: 'normal',
};

type DateRange = RTYFilterParams['dateRange'];

function formatDateInput(value: Date | undefined): string {
  if (!value || Number.isNaN(value.getTime())) return '';
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function parseDateInput(value: string): Date | undefined {
  return value ? new Date(`${value}T00:00:00.000Z`) : undefined;
}

function DateRangePicker({ value, onChange }: { value: DateRange; onChange: (range: DateRange) => void }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(formatDateInput(value.from));
  const [end, setEnd] = useState(formatDateInput(value.to));
  const containerRef = useRef<HTMLDivElement>(null);
  const invalidRange = Boolean(start && end && start > end);
  const summary = start || end ? `${start || '开始日期'} 至 ${end || '结束日期'}` : '选择时间范围';

  useEffect(() => {
    setStart(formatDateInput(value.from));
    setEnd(formatDateInput(value.to));
  }, [value.from, value.to]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const apply = () => {
    if (invalidRange) return;
    onChange({ from: parseDateInput(start), to: parseDateInput(end) });
    setOpen(false);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex h-9 w-full items-center gap-2 rounded-md border bg-white px-2.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
          open ? 'border-blue-400 ring-2 ring-blue-500/15' : 'border-slate-300 hover:border-slate-400'
        }`}
      >
        <CalendarDays className="size-4 shrink-0 text-blue-600" aria-hidden="true" />
        <span className={`min-w-0 flex-1 truncate ${start || end ? 'font-medium text-slate-700' : 'text-slate-400'}`}>{summary}</span>
        {start || end ? <span className="size-1.5 shrink-0 rounded-full bg-blue-500" aria-label="已设置日期范围" /> : null}
      </button>

      {open && (
        <div role="dialog" aria-label="选择时间范围" className="absolute left-0 top-full z-50 mt-1.5 w-[320px] overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg shadow-slate-900/10">
          <div className="flex items-start justify-between border-b border-slate-100 bg-slate-50 px-3 py-2.5">
            <div>
              <p className="text-xs font-semibold text-slate-700">时间范围</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="-mr-1 -mt-1 inline-flex size-7 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700" aria-label="关闭时间范围选择" title="关闭">
              <X className="size-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 p-3">
            <label className="flex flex-col gap-1.5 text-[11px] font-medium text-slate-600">
              开始日期
              <input
                type="date"
                value={start}
                max={end || undefined}
                onChange={(event) => setStart(event.target.value)}
                className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[11px] font-medium text-slate-600">
              结束日期
              <input
                type="date"
                value={end}
                min={start || undefined}
                onChange={(event) => setEnd(event.target.value)}
                className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15"
              />
            </label>
          </div>
          <div className="border-t border-slate-100 px-3 pb-3 pt-2">
            <MonthQuickPicker from={start} to={end} onChange={(nextStart, nextEnd) => { setStart(nextStart); setEnd(nextEnd); }} accent="blue" />
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2.5">
            <button
              type="button"
              onClick={() => {
                setStart('');
                setEnd('');
                onChange({ from: undefined, to: undefined });
                setOpen(false);
              }}
              className="text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              清除范围
            </button>
            <div className="flex items-center gap-2">
              {invalidRange && <span className="text-[11px] text-red-600">开始日期不能晚于结束日期</span>}
              <button type="button" onClick={apply} disabled={invalidRange} className="h-8 rounded-md bg-blue-700 px-3 text-xs font-medium text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">
                应用
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface FilterPanelProps {
  initialFilters: RTYFilterParams;
  onFiltersChange: Dispatch<SetStateAction<RTYFilterParams>>;
  onSearch: () => void;
  onAlertModalOpen: () => void;
  onExportConfirm: () => Promise<void>;
  exporting: boolean;
  exportDisabled: boolean;
}

export function FilterPanel({
  initialFilters,
  onFiltersChange,
  onSearch,
  onAlertModalOpen,
  onExportConfirm,
  exporting,
  exportDisabled,
}: FilterPanelProps) {
  const filters = initialFilters;
  const [productModelList, setProductModelList] = useState<{ model: string; count: number }[]>([]);
  const [baseList, setBaseList] = useState<{ base: string; count: number }[]>([]);
  const [customerList, setCustomerList] = useState<string[]>([]);
  const [showModelSuggestions, setShowModelSuggestions] = useState(false);
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);
  const [showBaseSuggestions, setShowBaseSuggestions] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [baseSearch, setBaseSearch] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');

  const update = (partial: Partial<RTYFilterParams>) => {
    onFiltersChange(current => ({ ...current, ...partial }));
  };

  const updateFromCurrent = (getPartial: (current: RTYFilterParams) => Partial<RTYFilterParams>) => {
    onFiltersChange(current => ({ ...current, ...getPartial(current) }));
  };

  const selectedModels = filters.productModels?.length
    ? filters.productModels
    : filters.productModel !== 'all' ? [filters.productModel] : [];
  const selectedBases = filters.bases?.length
    ? filters.bases
    : filters.base !== 'all' ? [filters.base] : [];
  const selectedCustomers = filters.customers?.length
    ? filters.customers
    : filters.customer ? [filters.customer] : [];

  useEffect(() => {
    const closeMenus = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-rty-filter-menu]')) {
        if (event.target instanceof Element && event.target.closest('[data-rty-filter-trigger]')) return;
        setShowModelSuggestions(false);
        setShowBaseSuggestions(false);
        setShowCustomerSuggestions(false);
      }
    };
    document.addEventListener('mousedown', closeMenus);
    return () => document.removeEventListener('mousedown', closeMenus);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const options = await rtyApi.getFilterOptions(filters.orderScope);
        setProductModelList(options.productModels);
        setBaseList(options.bases);
        setCustomerList([NO_CUSTOMER_ID, ...options.customers.filter((value) => value !== NO_CUSTOMER_ID)]);
      } catch (error) {
        console.error('Failed to fetch filters data', error);
      }
    };
    load();
  }, [filters.orderScope]);

  const filteredCustomers = customerList.filter(customer =>
    !customerSearch || customerIdLabel(customer).toLowerCase().includes(customerSearch.toLowerCase())
  );

  const handleClear = () => {
    onFiltersChange({ ...EMPTY_FILTERS });
  };

  return (
    <div className="flex-shrink-0 bg-white p-3 rounded-md border border-slate-200 shadow-sm mb-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px] max-w-xs">
            <div className="mb-1.5 flex items-center gap-1">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">时间范围</label>
              <HelpTooltip label="查看 RTY 时间与订单口径">
                <p>按销售订单计划开始日期（GSTRS）筛选，仅支持 2026 年。</p>
                <p className="mt-1">统计排除订单状态 DLID、RELEASED 及订单类型 C001；L6 订单按订单范围单独统计。</p>
              </HelpTooltip>
            </div>
            <DateRangePicker value={filters.dateRange} onChange={(dateRange) => update({ dateRange })} />
          </div>

          <div className="flex-1 min-w-[100px] max-w-[140px] opacity-50">
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">统计方式</label>
            <select className="w-full border border-slate-200 rounded-sm px-2 py-1.5 text-xs text-slate-400 bg-slate-100 cursor-not-allowed" disabled>
              <option value="整体直通率">整体直通率</option>
              <option value="过站直通率">过站直通率</option>
            </select>
          </div>

          <div className="flex-1 min-w-[100px] max-w-[160px]">
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">计算方法</label>
            <select
              disabled
              aria-label="计算方法，当前不可用"
              className="w-full cursor-not-allowed border border-slate-200 rounded-sm bg-slate-100 px-2 py-1.5 text-xs text-slate-400 outline-none"
              value={filters.calculationMethod || (COMPOSITE_MODELS.has(filters.productModel) ? 'composite' : 'normal')}
            >
              <option value="normal">普通机型</option>
              <option value="composite">复合机型</option>
            </select>
          </div>

          <div className="flex-1 min-w-[130px] max-w-[170px]">
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">订单范围</label>
            <select
              className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all bg-white"
              value={filters.orderScope}
              onChange={e => update({ orderScope: e.target.value as RTYFilterParams['orderScope'] })}
            >
              <option value="normal">普通订单（不含 L6）</option>
              <option value="l6">L6 订单</option>
            </select>
          </div>

          <div className="flex-1 min-w-[150px] max-w-[240px] relative">
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">生产机型</label>
            <button data-rty-filter-trigger type="button" aria-label="选择机型" aria-expanded={showModelSuggestions} onClick={() => { setShowModelSuggestions(!showModelSuggestions); setShowBaseSuggestions(false); setShowCustomerSuggestions(false); }} className="flex h-[30px] w-full items-center justify-between gap-2 rounded-sm border border-slate-300 bg-white px-2 text-left text-xs text-slate-700">
              <span className="truncate">{selectedModels.length ? `已选 ${selectedModels.length} 个机型` : '全部机型'}</span><ChevronDown className="size-3.5 shrink-0" />
            </button>
            {showModelSuggestions && (
              <div data-rty-filter-menu className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-sm shadow-lg">
                <input aria-label="搜索机型" value={modelSearch} onChange={event => setModelSearch(event.target.value)} placeholder="搜索机型" className="h-8 w-full border-b border-slate-100 px-2 text-xs outline-none" />
                <div className="flex justify-between border-b border-slate-100 px-2 py-1.5 text-xs"><button type="button" onClick={() => update({ productModels: productModelList.map(item => item.model), productModel: 'all' })}>全选</button><button type="button" onClick={() => update({ productModels: [], productModel: 'all' })}>清空</button></div>
                <div className="max-h-48 overflow-auto">
                {productModelList
                  .filter(item => item.model.toLowerCase().includes(modelSearch.toLowerCase()))
                  .map(item => (
                    <label key={item.model} className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs hover:bg-blue-50">
                      <input type="checkbox" checked={selectedModels.includes(item.model)} onChange={() => updateFromCurrent(current => {
                        const selected = current.productModels?.length
                          ? current.productModels
                          : current.productModel !== 'all' ? [current.productModel] : [];
                        const next = selected.includes(item.model) ? selected.filter(value => value !== item.model) : [...selected, item.model];
                        return { productModels: next, productModel: 'all' };
                      })} />
                      <span className="truncate">{item.model}</span>
                      <span className="ml-auto text-[10px] text-slate-400">{COMPOSITE_MODELS.has(item.model) ? '复合 · ' : ''}{item.count}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 min-w-[130px] max-w-[190px] relative">
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">基地</label>
            <button data-rty-filter-trigger type="button" aria-label="选择基地" aria-expanded={showBaseSuggestions} onClick={() => { setShowBaseSuggestions(!showBaseSuggestions); setShowModelSuggestions(false); setShowCustomerSuggestions(false); }} className="flex h-[30px] w-full items-center justify-between gap-2 rounded-sm border border-slate-300 bg-white px-2 text-left text-xs text-slate-700"><span className="truncate">{(filters.bases?.length ?? 0) ? `已选 ${filters.bases!.length} 个基地` : '全部基地'}</span><ChevronDown className="size-3.5 shrink-0" /></button>
            {showBaseSuggestions && <div data-rty-filter-menu className="absolute z-50 top-full left-0 right-0 mt-1 rounded-sm border border-slate-200 bg-white shadow-lg"><input aria-label="搜索基地" value={baseSearch} onChange={event => setBaseSearch(event.target.value)} placeholder="搜索基地" className="h-8 w-full border-b border-slate-100 px-2 text-xs outline-none" /><div className="flex justify-between border-b border-slate-100 px-2 py-1.5 text-xs"><button type="button" onClick={() => update({ bases: baseList.map(item => item.base), base: 'all' })}>全选</button><button type="button" onClick={() => update({ bases: [], base: 'all' })}>清空</button></div><div className="max-h-48 overflow-auto">{baseList.filter(item => item.base.toLowerCase().includes(baseSearch.toLowerCase())).map(item => <label key={item.base} className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs hover:bg-blue-50"><input type="checkbox" checked={selectedBases.includes(item.base)} onChange={() => updateFromCurrent(current => {
              const selected = current.bases?.length
                ? current.bases
                : current.base !== 'all' ? [current.base] : [];
              const next = selected.includes(item.base) ? selected.filter(value => value !== item.base) : [...selected, item.base];
              return { bases: next, base: 'all' };
            })} />{item.base}<span className="ml-auto text-slate-400">{item.count}</span></label>)}</div></div>}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[140px] max-w-[180px]">
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">销售订单</label>
            <input
              type="text"
              placeholder="请输入销售订单（支持逗号分隔多个）"
              className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all bg-white"
              value={filters.salesOrder}
              onChange={e => update({ salesOrder: e.target.value })}
            />
          </div>

          <div className="flex-1 min-w-[140px] max-w-[180px]">
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">生产订单</label>
            <input
              type="text"
              placeholder="请输入生产订单"
              className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all bg-white"
              value={filters.productionOrder}
              onChange={e => update({ productionOrder: e.target.value })}
            />
          </div>

          <div className="flex-1 min-w-[100px] max-w-[140px]">
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">整机序列号</label>
            <input
              type="text"
              placeholder="请输入整机序列号"
              className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all bg-white"
              value={filters.serialNumber}
              onChange={e => update({ serialNumber: e.target.value })}
            />
          </div>

          <div className="flex-1 min-w-[160px] max-w-[240px] relative">
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">客户 ID</label>
            <button data-rty-filter-trigger type="button" aria-label="选择客户 ID" aria-expanded={showCustomerSuggestions} onClick={() => { setShowCustomerSuggestions(!showCustomerSuggestions); setShowModelSuggestions(false); setShowBaseSuggestions(false); }} className="flex h-[30px] w-full items-center justify-between gap-2 rounded-sm border border-slate-300 bg-white px-2 text-left text-xs text-slate-700"><span className="truncate">{selectedCustomers.length ? `已选 ${selectedCustomers.length} 个客户` : '全部客户 ID'}</span><ChevronDown className="size-3.5 shrink-0" /></button>
            {showCustomerSuggestions && (
              <div data-rty-filter-menu className="absolute z-50 top-full left-0 right-0 mt-1 rounded-sm border border-slate-200 bg-white shadow-lg">
                <input aria-label="搜索客户 ID" value={customerSearch} onChange={event => setCustomerSearch(event.target.value)} placeholder="搜索客户 ID" className="h-8 w-full border-b border-slate-100 px-2 text-xs outline-none" />
                <div className="flex justify-between border-b border-slate-100 px-2 py-1.5 text-xs"><button type="button" onClick={() => update({ customers: [NO_CUSTOMER_ID, ...customerList.filter(value => value !== NO_CUSTOMER_ID)], customer: '' })}>全选</button><button type="button" onClick={() => update({ customers: [], customer: '' })}>清空</button></div>
                <div className="max-h-48 overflow-auto">
                <label
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-blue-50"
                >
                  <input type="checkbox" checked={selectedCustomers.includes(NO_CUSTOMER_ID)} onChange={() => updateFromCurrent(current => {
                    const selected = current.customers?.length
                      ? current.customers
                      : current.customer ? [current.customer] : [];
                    return {
                      customers: selected.includes(NO_CUSTOMER_ID) ? selected.filter(value => value !== NO_CUSTOMER_ID) : [...selected, NO_CUSTOMER_ID],
                      customer: '',
                    };
                  })} />无客户ID
                </label>
                {filteredCustomers.length > 0 ? filteredCustomers.filter(customer => customer !== NO_CUSTOMER_ID).map(customer => (
                  <label
                    key={customer}
                    className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs hover:bg-blue-50"
                  >
                    <input type="checkbox" checked={selectedCustomers.includes(customer)} onChange={() => updateFromCurrent(current => {
                      const selected = current.customers?.length
                        ? current.customers
                        : current.customer ? [current.customer] : [];
                      return {
                        customers: selected.includes(customer) ? selected.filter(value => value !== customer) : [...selected, customer],
                        customer: '',
                      };
                    })} />
                    <span className="truncate" title={customer}>{customerIdLabel(customer)}</span>
                  </label>
                )) : (
                  <div className="px-3 py-2 text-xs text-slate-400">无匹配客户</div>
                )}
                </div>
              </div>
            )}
          </div>

          <div className="flex-shrink-0 flex items-center gap-2">
            <button
              onClick={handleClear}
              className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-sm text-xs font-medium transition-colors flex items-center shadow-sm"
            >
              <RotateCcw className="w-3 h-3 mr-1 text-slate-500" />
              清空
            </button>
            <button
              onClick={onSearch}
              className="bg-[#1e40af] hover:bg-[#1e3a8a] text-white px-4 py-1.5 rounded-sm text-xs font-medium transition-colors flex items-center shadow-sm"
            >
              <Search className="w-3.5 h-3.5 mr-1.5" />
              查询
            </button>
          </div>

          <div className="flex-shrink-0 ml-auto flex items-center gap-2 relative">
            <button
              onClick={onAlertModalOpen}
              className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-1.5 rounded-sm text-xs font-medium transition-colors flex items-center shadow-sm"
            >
              <BarChart3 className="w-3.5 h-3.5 mr-1.5 text-blue-500" />
              周期统计
            </button>
            <div className="relative">
              <button
                onClick={() => void onExportConfirm()}
                disabled={exporting || exportDisabled}
                className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-1.5 rounded-sm text-xs font-medium transition-colors flex items-center shadow-sm disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5 mr-1.5 text-emerald-500" />
                {exporting ? '导出中...' : '导出'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
