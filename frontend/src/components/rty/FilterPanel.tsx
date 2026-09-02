import { useState, useEffect } from 'react';
import { BarChart3, Download, RotateCcw, Search } from 'lucide-react';
import { rtyApi } from '../../api/rtyApi';
import type { RTYFilterParams } from '../../types';
import { ExportPanel } from './index';

const EXPORT_COLUMNS: Record<string, string> = {
  time: '时间',
  productModel: '生产机型',
  customer: '客户 ID',
  base: '基地',
  defectCount: '故障机器数',
  inputCount: '产量（WMENG）',
  rtyRate: '直通率(%)',
  targetRate: '直通率指标(%)',
  status: '达成状况',
  salesOrder: '销售订单',
  productionOrder: '生产订单',
  serialNumbers: '机器SN',
  productLine: '产线',
};

const COMPOSITE_MODELS = new Set(['6210 C21 BOX', '6215 C32']);

const EMPTY_FILTERS: RTYFilterParams = {
  dateRange: { from: undefined, to: undefined },
  productModel: 'all',
  customer: '',
  base: 'all',
  salesOrder: '',
  productionOrder: '',
  serialNumber: '',
  orderScope: 'normal',
};

interface FilterPanelProps {
  initialFilters: RTYFilterParams;
  onFiltersChange: (filters: RTYFilterParams) => void;
  onSearch: () => void;
  onAlertModalOpen: () => void;
  onExportConfirm: (selectedColumns: Record<string, boolean>) => void;
}

export function FilterPanel({
  initialFilters,
  onFiltersChange,
  onSearch,
  onAlertModalOpen,
  onExportConfirm,
}: FilterPanelProps) {
  const [filters, setFilters] = useState<RTYFilterParams>(initialFilters);
  const [productModelList, setProductModelList] = useState<{ model: string; count: number }[]>([]);
  const [baseList, setBaseList] = useState<{ base: string; count: number }[]>([]);
  const [customerList, setCustomerList] = useState<string[]>([]);
  const [showModelSuggestions, setShowModelSuggestions] = useState(false);
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);
  const [showExportPanel, setShowExportPanel] = useState(false);
  const [exportColumns, setExportColumns] = useState<Record<string, boolean>>({
    time: true,
    productModel: true,
    customer: true,
    base: true,
    defectCount: true,
    inputCount: true,
    rtyRate: true,
    targetRate: true,
    status: true,
    salesOrder: true,
    productionOrder: true,
    serialNumbers: false,
    productLine: false,
  });

  const update = (partial: Partial<RTYFilterParams>) => {
    const newFilters = { ...filters, ...partial };
    setFilters(newFilters);
    onFiltersChange(newFilters);
  };

  useEffect(() => {
    setFilters(initialFilters);
  }, [initialFilters]);

  useEffect(() => {
    const load = async () => {
      try {
        const options = await rtyApi.getFilterOptions(filters.orderScope);
        setProductModelList(options.productModels);
        setBaseList(options.bases);
        setCustomerList(options.customers);
      } catch (error) {
        console.error('Failed to fetch filters data', error);
      }
    };
    load();
  }, [filters.orderScope]);

  const handleExportConfirm = () => {
    onExportConfirm(exportColumns);
    setShowExportPanel(false);
  };

  const filteredCustomers = customerList.filter(customer =>
    !filters.customer || customer.toLowerCase().includes(filters.customer.toLowerCase())
  );

  const handleClear = () => {
    setFilters({ ...EMPTY_FILTERS });
    onFiltersChange({ ...EMPTY_FILTERS });
    onSearch();
  };

  return (
    <div className="flex-shrink-0 bg-white p-3 rounded-md border border-slate-200 shadow-sm mb-4">
      <div className="flex flex-col gap-3">
        <p className="text-[11px] text-slate-500">
          统计范围已排除订单状态 DLID、RELEASED 及订单类型 C001；L6 订单按范围单独统计。
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px] max-w-xs">
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
              时间范围
              <button
                type="button"
                className="ml-1 text-slate-400 hover:text-slate-600 cursor-help"
                title="销售订单计划开始日期（GSTRS），仅支持 2026 年"
              >
                ?
              </button>
            </label>
            <div className="flex items-center space-x-1">
              <input
                type="date"
                className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all"
                value={filters.dateRange.from ? filters.dateRange.from.toISOString().split('T')[0] : ''}
                onChange={(e) => update({ dateRange: { ...filters.dateRange, from: e.target.value ? new Date(e.target.value) : undefined } })}
              />
              <span className="text-slate-400 text-xs">-</span>
              <input
                type="date"
                className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all"
                value={filters.dateRange.to ? filters.dateRange.to.toISOString().split('T')[0] : ''}
                onChange={(e) => update({ dateRange: { ...filters.dateRange, to: e.target.value ? new Date(e.target.value) : undefined } })}
              />
            </div>
          </div>

          <div className="flex-1 min-w-[100px] max-w-[140px] opacity-50">
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">统计方式</label>
            <select className="w-full border border-slate-200 rounded-sm px-2 py-1.5 text-xs text-slate-400 bg-slate-100 cursor-not-allowed" disabled>
              <option value="整体直通率">整体直通率</option>
              <option value="过站直通率">过站直通率</option>
            </select>
          </div>

          <div className="flex-1 min-w-[100px] max-w-[160px] opacity-50">
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">计算方法</label>
            <select
              className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all bg-white"
              value={filters.calculationMethod || (COMPOSITE_MODELS.has(filters.productModel) ? 'composite' : 'normal')}
              onChange={e => update({ calculationMethod: e.target.value as RTYFilterParams['calculationMethod'] })}
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

          <div className="flex-1 min-w-[120px] max-w-[220px] relative">
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">生产机型</label>
            <input
              type="text"
              placeholder="输入机型名称搜索..."
              className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all bg-white"
              value={filters.productModel === 'all' ? '' : filters.productModel}
              onChange={e => {
                update({ productModel: e.target.value || 'all' });
                setShowModelSuggestions(true);
              }}
              onFocus={() => setShowModelSuggestions(true)}
              onBlur={() => setTimeout(() => setShowModelSuggestions(false), 200)}
            />
            {showModelSuggestions && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-sm shadow-lg max-h-48 overflow-auto">
                <button
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 transition-colors ${filters.productModel === 'all' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600'}`}
                  onMouseDown={() => { update({ productModel: 'all' }); setShowModelSuggestions(false); }}
                >
                  全部机型
                </button>
                {productModelList
                  .filter(item => !filters.productModel || filters.productModel === 'all' || item.model.toLowerCase().includes(filters.productModel.toLowerCase()))
                  .map(item => (
                    <button
                      key={item.model}
                      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 transition-colors flex justify-between items-center ${filters.productModel === item.model ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-600'}`}
                      onMouseDown={() => { update({ productModel: item.model }); setShowModelSuggestions(false); }}
                    >
                      <span className="truncate">{item.model}</span>
                      <span className="ml-2 flex shrink-0 items-center gap-1.5 text-[10px] text-slate-400">
                        {COMPOSITE_MODELS.has(item.model) && (
                          <span className="rounded-sm bg-amber-50 px-1 py-0.5 font-medium text-amber-700">复合</span>
                        )}
                        {item.count}
                      </span>
                    </button>
                  ))}
              </div>
            )}
          </div>

          <div className="flex-1 min-w-[80px] max-w-[120px]">
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">基地</label>
            <select
              className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all bg-white"
              value={filters.base}
              onChange={e => update({ base: e.target.value })}
            >
              <option value="all">全部基地</option>
              {baseList.map(item => (
                <option key={item.base} value={item.base}>{item.base} ({item.count})</option>
              ))}
            </select>
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

          <div className="flex-1 min-w-[140px] max-w-[220px] relative">
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">客户 ID</label>
            <input
              type="text"
              placeholder="请输入客户 ID"
              className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all bg-white"
              value={filters.customer}
              onChange={e => {
                update({ customer: e.target.value });
                setShowCustomerSuggestions(true);
              }}
              onFocus={() => setShowCustomerSuggestions(true)}
              onBlur={() => setTimeout(() => setShowCustomerSuggestions(false), 200)}
            />
            {showCustomerSuggestions && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-48 overflow-auto rounded-sm border border-slate-200 bg-white shadow-lg">
                <button
                  type="button"
                  className={`w-full px-3 py-1.5 text-left text-xs hover:bg-blue-50 ${!filters.customer ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600'}`}
                  onMouseDown={() => {
                    update({ customer: '' });
                    setShowCustomerSuggestions(false);
                  }}
                >
                  全部客户 ID
                </button>
                {filteredCustomers.length > 0 ? filteredCustomers.map(customer => (
                  <button
                    key={customer}
                    type="button"
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-blue-50 ${filters.customer === customer ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600'}`}
                    onMouseDown={() => {
                      update({ customer });
                      setShowCustomerSuggestions(false);
                    }}
                  >
                    <span className="truncate" title={customer}>{customer}</span>
                  </button>
                )) : (
                  <div className="px-3 py-2 text-xs text-slate-400">无匹配客户</div>
                )}
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
                onClick={() => setShowExportPanel(!showExportPanel)}
                className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-1.5 rounded-sm text-xs font-medium transition-colors flex items-center shadow-sm"
              >
                <Download className="w-3.5 h-3.5 mr-1.5 text-emerald-500" />
                导出
              </button>
              {showExportPanel && (
                <ExportPanel
                  columns={EXPORT_COLUMNS}
                  selected={exportColumns}
                  onToggle={key => setExportColumns(prev => ({ ...prev, [key]: !prev[key] }))}
                  onConfirm={handleExportConfirm}
                  onClose={() => setShowExportPanel(false)}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
