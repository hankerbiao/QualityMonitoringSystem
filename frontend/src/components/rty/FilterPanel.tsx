import { useState, useEffect } from 'react';
import { BarChart3, Download, Search } from 'lucide-react';
import { rtyApi } from '../../api/rtyApi';
import type { RTYFilterParams } from '../../types';
import { SuggestionDropdown, ExportPanel } from './index';

const BASES = ['all', '天津', '昆山', '桐乡', '大同'];
const EXPORT_COLUMNS: Record<string, string> = {
  time: '时间',
  productModel: '生产机型',
  customer: '客户',
  base: '基地',
  defectCount: '故障数量',
  inputCount: '投入数量',
  rtyRate: '直通率(%)',
  targetRate: '直通率指标(%)',
  status: '达成状况',
  salesOrder: '销售订单',
  productionOrder: '生产订单',
  serialNumbers: '机器SN',
  productLine: '产线',
  orderType: '订单类型',
  planStartDate: '计划开始日期',
  planEndDate: '计划结束时间',
};

interface FilterPanelProps {
  initialFilters: RTYFilterParams;
  onFiltersChange: (filters: RTYFilterParams) => void;
  onSearch: () => void;
  onAlertModalOpen: () => void;
  onAiChatOpen: () => void;
  onExportConfirm: (selectedColumns: Record<string, boolean>) => void;
}

export function FilterPanel({
  initialFilters,
  onFiltersChange,
  onSearch,
  onAlertModalOpen,
  onAiChatOpen,
  onExportConfirm,
}: FilterPanelProps) {
  const [filters, setFilters] = useState<RTYFilterParams>(initialFilters);
  const [productModelList, setProductModelList] = useState<{ model: string; count: number }[]>([]);
  const [soSuggestions, setSoSuggestions] = useState<{ salesOrder: string; productionOrders: string[] }[]>([]);
  const [showSoSuggestions, setShowSoSuggestions] = useState(false);
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
    orderType: false,
    planStartDate: false,
    planEndDate: false,
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
        setProductModelList(await rtyApi.getProductModels());
      } catch (error) {
        console.error('Failed to fetch product models', error);
      }
    };
    load();
  }, []);

  useEffect(() => {
    const salesOrders = filters.salesOrder.split(/[,，]/).map(o => o.trim()).filter(Boolean);
    const validOrders = salesOrders.filter(o => o.length >= 2);

    if (validOrders.length === 0) {
      setSoSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const results = await Promise.all(
          validOrders.map(async (so) => {
            const pos = await rtyApi.getProductionOrdersBySalesOrder(so);
            return { salesOrder: so, productionOrders: pos };
          })
        );
        setSoSuggestions(results);
        setShowSoSuggestions(true);
      } catch {
        setSoSuggestions([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [filters.salesOrder]);

  const handleExportConfirm = () => {
    onExportConfirm(exportColumns);
    setShowExportPanel(false);
  };

  return (
    <div className="flex-shrink-0 bg-white p-3 rounded-md border border-slate-200 shadow-sm mb-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px] max-w-xs">
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">时间范围</label>
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
            <select className="w-full border border-slate-200 rounded-sm px-2 py-1.5 text-xs text-slate-400 bg-slate-100 cursor-not-allowed" disabled>
              <option value="普通机型">普通机型</option>
              <option value="复合机型">复合机型</option>
            </select>
          </div>

          <div className="flex-1 min-w-[120px] max-w-[180px]">
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">生产机型</label>
            <select
              className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all bg-white"
              value={filters.productModel}
              onChange={e => update({ productModel: e.target.value })}
            >
              <option value="all">全部机型</option>
              {productModelList.map(item => (
                <option key={item.model} value={item.model}>{item.model} ({item.count})</option>
              ))}
            </select>
          </div>

          <div className="flex-1 min-w-[80px] max-w-[120px]">
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">基地</label>
            <select
              className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all bg-white"
              value={filters.base}
              onChange={e => update({ base: e.target.value })}
            >
              <option value="all">全部基地</option>
              {BASES.filter(b => b !== 'all').map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>

          <div className="flex-1 min-w-[80px] max-w-[120px]">
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">聚合方式</label>
            <select
              className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all bg-white"
              value={filters.aggregateBy || 'mfg_order'}
              onChange={e => update({ aggregateBy: e.target.value as RTYFilterParams['aggregateBy'] })}
            >
              <option value="mfg_order">按生产订单</option>
              <option value="product_model">按生产机型</option>
              <option value="base">按基地</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[140px] max-w-[180px] relative">
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">销售订单</label>
            <input
              type="text"
              placeholder="输入后显示生产订单建议"
              className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all bg-white"
              value={filters.salesOrder}
              onChange={e => {
                update({ salesOrder: e.target.value });
                if (soSuggestions.length > 0) setShowSoSuggestions(true);
              }}
              onFocus={() => { if (soSuggestions.length > 0) setShowSoSuggestions(true); }}
              onBlur={() => setTimeout(() => setShowSoSuggestions(false), 200)}
            />
            {showSoSuggestions && soSuggestions.length > 0 && (
              <SuggestionDropdown
                suggestions={soSuggestions}
                onSelect={(so, po) => {
                  update({ salesOrder: so, productionOrder: po });
                  setShowSoSuggestions(false);
                }}
              />
            )}
          </div>

          <div className="flex-1 min-w-[140px] max-w-[180px] relative">
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">生产订单</label>
            <input
              type="text"
              placeholder={filters.salesOrder ? "点击显示对应生产订单" : "输入后显示建议"}
              className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all bg-white"
              value={filters.productionOrder}
              onChange={e => update({ productionOrder: e.target.value })}
              onFocus={() => { if (soSuggestions.length > 0) setShowSoSuggestions(true); }}
              onBlur={() => setTimeout(() => setShowSoSuggestions(false), 200)}
            />
            {showSoSuggestions && soSuggestions.length > 0 && (
              <SuggestionDropdown
                suggestions={soSuggestions}
                onSelect={(so, po) => {
                  update({ salesOrder: so, productionOrder: po });
                  setShowSoSuggestions(false);
                }}
              />
            )}
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

          <div className="flex-1 min-w-[120px] max-w-[160px]">
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">客户</label>
            <input
              type="text"
              placeholder="请输入客户名称"
              className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all bg-white"
              value={filters.customer}
              onChange={e => update({ customer: e.target.value })}
            />
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
            <button
              onClick={onAiChatOpen}
              className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-1.5 rounded-sm text-xs font-medium transition-colors flex items-center shadow-sm"
            >
              <span className="mr-1.5 text-purple-500 font-bold">AI</span>
              智能分析
            </button>
            <button
              onClick={onSearch}
              className="bg-[#1e40af] hover:bg-[#1e3a8a] text-white px-4 py-1.5 rounded-sm text-xs font-medium transition-colors flex items-center shadow-sm"
            >
              <Search className="w-3.5 h-3.5 mr-1.5" />
              查询
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}