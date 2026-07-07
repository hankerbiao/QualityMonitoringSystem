import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, BarChart3, ArrowUp, ArrowDown, ArrowUpDown, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { rtyApi, RTYFilterParams } from '../api/rtyApi';
import { RTYData } from '../types';
import { useModelTargets } from '../context/ModelTargetsContext';
import DefectModal from '../components/DefectModal';
import InputModal from '../components/InputModal';
import AlertConfigModal from '../components/AlertConfigModal';

/** 导出列定义：key → 中文表头，两处复用（导出面板 + handleExport） */
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
};

/** 排序字段类型 */
type SortField = 'time' | 'defectCount' | 'inputCount' | 'rtyRate';

/** 表头排序图标：当前排序列显示方向箭头，其余列显示灰色双向箭头 */
function SortIcon({ field, activeField, direction }: { field: SortField; activeField: SortField | null; direction: 'asc' | 'desc' }) {
  if (activeField !== field) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
  return direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
}

export default function RTYPage() {
  const navigate = useNavigate();
  
  // 过滤条件状态
  const [filters, setFilters] = useState<RTYFilterParams>({
    statMethod: '整体直通率',
    dateRange: { from: undefined, to: undefined },
    model: 'all',
    productModel: 'all',
    customer: '',
    base: 'all',
    salesOrder: '',
    productionOrder: '',
    serialNumber: ''
  });

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<RTYData[]>([]);
  const [sortField, setSortField] = useState<'time' | 'defectCount' | 'inputCount' | 'rtyRate' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
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
    status: true
  });
  
  const { modelTargets } = useModelTargets();
  
  // 弹窗状态
  const [activeDefectId, setActiveDefectId] = useState<string | null>(null);
  const [activeInputId, setActiveInputId] = useState<string | null>(null);
  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);

  // 获取数据
  const fetchData = async () => {
    setLoading(true);
    try {
      const result = await rtyApi.getRTYData(filters);
      setData(result);
    } catch (error) {
      console.error("Failed to fetch data", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const result = await rtyApi.getRTYData(filters);
        if (!cancelled) setData(result);
      } catch (error) {
        if (!cancelled) console.error("Failed to fetch data", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = () => {
    fetchData();
  };

  const handleSort = (field: 'time' | 'defectCount' | 'inputCount' | 'rtyRate') => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const toggleExportColumn = (key: string) => {
    setExportColumns(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleExport = () => {
    const selectedKeys = Object.entries(exportColumns).filter(([, v]) => v).map(([k]) => k);
    const exportData = sortedData.map(row => {
      const item: Record<string, any> = {};
      selectedKeys.forEach(key => {
        if (key === 'status') {
          item[EXPORT_COLUMNS[key]] = row.rtyRate >= (modelTargets[row.productModel] || row.targetRate) ? '达成' : '未达标';
        } else {
          item[EXPORT_COLUMNS[key]] = row[key as keyof RTYData];
        }
      });
      return item;
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'RTY数据');
    XLSX.writeFile(wb, `RTY数据导出_${new Date().toISOString().split('T')[0]}.xlsx`);
    setShowExportPanel(false);
  };

  const sortedData = useMemo(() => {
    if (!sortField) return data;
    return [...data].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data, sortField, sortDirection]);

  return (
    <div className="h-screen bg-slate-50 flex flex-col overflow-hidden">
      {/* 顶部导航 */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => navigate('/')}
            className="p-1.5 hover:bg-slate-100 rounded-sm transition-colors text-slate-500"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-lg font-semibold text-slate-800">数质看板 — RTY 整机综合直通率</h1>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-400 font-medium">快速切换看板:</span>
          <div className="flex items-center gap-1">
            <button
              disabled
              className="px-2 py-1 bg-blue-600 text-white rounded-sm font-medium"
            >
              RTY
            </button>
            <button
              onClick={() => navigate('/lrr')}
              className="px-2 py-1 text-slate-500 hover:bg-slate-100 rounded-sm transition-colors"
            >
              LRR <span className="text-slate-400">故障率</span>
            </button>
            <button
              onClick={() => navigate('/doa')}
              className="px-2 py-1 text-slate-500 hover:bg-slate-100 rounded-sm transition-colors"
            >
              DOA <span className="text-slate-400">换件率</span>
            </button>
            <button
              onClick={() => navigate('/mfr')}
              className="px-2 py-1 text-slate-500 hover:bg-slate-100 rounded-sm transition-colors"
            >
              MFR <span className="text-slate-400">月化</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col p-4 max-w-full mx-auto w-full overflow-hidden">
        {/* 过滤面板 */}
        <div className="flex-shrink-0 bg-white p-3 rounded-md border border-slate-200 shadow-sm mb-4">
          <div className="flex flex-col gap-3">
            {/* 第一行 */}
            <div className="flex flex-wrap items-end gap-3">
              {/* 时间范围 */}
              <div className="flex-1 min-w-[260px] max-w-xs">
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">时间范围</label>
                <div className="flex items-center space-x-1">
                  <input 
                    type="date"
                    className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all"
                    value={filters.dateRange.from ? filters.dateRange.from.toISOString().split('T')[0] : ''}
                    onChange={(e) => setFilters({
                      ...filters, 
                      dateRange: { ...filters.dateRange, from: e.target.value ? new Date(e.target.value) : undefined }
                    })}
                  />
                  <span className="text-slate-400 text-xs">-</span>
                  <input 
                    type="date"
                    className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all"
                    value={filters.dateRange.to ? filters.dateRange.to.toISOString().split('T')[0] : ''}
                    onChange={(e) => setFilters({
                      ...filters, 
                      dateRange: { ...filters.dateRange, to: e.target.value ? new Date(e.target.value) : undefined }
                    })}
                  />
                </div>
              </div>
              
              {/* 统计方式 */}
              <div className="flex-1 min-w-[120px] max-w-[160px]">
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">统计方式</label>
                <select 
                  className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all bg-white"
                  value={filters.statMethod}
                  onChange={e => setFilters({...filters, statMethod: e.target.value})}
                >
                  <option value="整体直通率">整体直通率</option>
                  <option value="过站直通率">过站直通率</option>
                </select>
              </div>

              {/* 计算方法 */}
              <div className="flex-1 min-w-[140px] max-w-[200px]">
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">计算方法</label>
                <select 
                  className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all bg-white"
                  value={filters.model}
                  onChange={e => setFilters({...filters, model: e.target.value})}
                >
                  <option value="all">全部方法</option>
                  <option value="普通机型">普通机型</option>
                  <option value="复合机型">复合机型</option>
                  <option value="Qiandaohu 一拖多机型">Qiandaohu 一拖多机型</option>
                </select>
              </div>

              {/* 生产机型 */}
              <div className="flex-1 min-w-[140px] max-w-[200px]">
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">生产机型</label>
                <select 
                  className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all bg-white"
                  value={filters.productModel}
                  onChange={e => setFilters({...filters, productModel: e.target.value})}
                >
                  <option value="all">全部机型</option>
                  <option value="6210 C21 BOX">6210 C21 BOX</option>
                  <option value="6210 C21">6210 C21</option>
                  <option value="6210 C31">6210 C31</option>
                </select>
              </div>

              {/* 基地 */}
              <div className="flex-1 min-w-[100px] max-w-[140px]">
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">基地</label>
                <select 
                  className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all bg-white"
                  value={filters.base}
                  onChange={e => setFilters({...filters, base: e.target.value})}
                >
                  <option value="all">全部基地</option>
                  <option value="天津">天津</option>
                  <option value="昆山">昆山</option>
                  <option value="桐乡">桐乡</option>
                  <option value="大同">大同</option>
                </select>
              </div>
            </div>
            
            {/* 第二行 */}
            <div className="flex flex-wrap items-end gap-3">
              {/* 客户 */}
              <div className="flex-1 min-w-[140px] max-w-[200px]">
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">客户</label>
                <input 
                  type="text"
                  placeholder="请输入客户名称"
                  className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all bg-white"
                  value={filters.customer}
                  onChange={e => setFilters({...filters, customer: e.target.value})}
                />
              </div>

              {/* 销售订单 */}
              <div className="flex-1 min-w-[140px] max-w-[200px]">
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">销售订单</label>
                <input 
                  type="text"
                  placeholder="请输入销售订单号"
                  className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all bg-white"
                  value={filters.salesOrder}
                  onChange={e => setFilters({...filters, salesOrder: e.target.value})}
                />
              </div>

              {/* 生产订单 */}
              <div className="flex-1 min-w-[140px] max-w-[200px]">
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">生产订单</label>
                <input 
                  type="text"
                  placeholder="请输入生产订单号"
                  className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all bg-white"
                  value={filters.productionOrder}
                  onChange={e => setFilters({...filters, productionOrder: e.target.value})}
                />
              </div>

              {/* 整机序列号 */}
              <div className="flex-1 min-w-[140px] max-w-[200px]">
                <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">整机序列号</label>
                <input 
                  type="text"
                  placeholder="请输入整机序列号"
                  className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs text-slate-700 focus:ring-1 focus:ring-blue-600 focus:border-blue-600 outline-none transition-all bg-white"
                  value={filters.serialNumber}
                  onChange={e => setFilters({...filters, serialNumber: e.target.value})}
                />
              </div>
              
              {/* 操作按钮 */}
              <div className="flex-shrink-0 ml-auto flex items-center gap-2 relative">
                <button 
                  onClick={() => setIsAlertModalOpen(true)}
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
                    <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-sm shadow-lg z-50 w-52">
                      <div className="px-3 py-2 border-b border-slate-100 text-xs font-semibold text-slate-700">选择导出字段</div>
                      <div className="p-2 max-h-64 overflow-y-auto">
                        {Object.entries(EXPORT_COLUMNS).map(([key, label]) => (
                          <label key={key} className="flex items-center gap-2 py-1 px-1 hover:bg-slate-50 cursor-pointer text-xs text-slate-700">
                            <input
                              type="checkbox"
                              checked={exportColumns[key]}
                              onChange={() => toggleExportColumn(key)}
                              className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600"
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                      <div className="px-3 py-2 border-t border-slate-100 flex justify-end">
                        <button
                          onClick={handleExport}
                          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded-sm font-medium"
                        >
                          确认导出
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <button 
                  onClick={handleSearch}
                  className="bg-[#1e40af] hover:bg-[#1e3a8a] text-white px-4 py-1.5 rounded-sm text-xs font-medium transition-colors flex items-center shadow-sm"
                >
                  <Search className="w-3.5 h-3.5 mr-1.5" />
                  查询
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 数据表格 */}
        <div className="flex-1 min-h-0 bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden">
          <div className="h-full overflow-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#f8fafc] border-b border-slate-200 text-slate-600 font-semibold text-xs">
                <tr>
                  <th 
                    className="px-3 py-2 border-r border-slate-100 last:border-none cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort('time')}
                  >
                    <span className="inline-flex items-center gap-1">
                      时间
                      <SortIcon field="time" activeField={sortField} direction={sortDirection} />
                    </span>
                  </th>
                  <th className="px-3 py-2 border-r border-slate-100 last:border-none">生产机型</th>
                  <th className="px-3 py-2 border-r border-slate-100 last:border-none">客户</th>
                  <th className="px-3 py-2 border-r border-slate-100 last:border-none">基地</th>
                  <th 
                    className="px-3 py-2 border-r border-slate-100 last:border-none cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort('defectCount')}
                  >
                    <span className="inline-flex items-center gap-1">
                      故障数量
                      <SortIcon field="defectCount" activeField={sortField} direction={sortDirection} />
                    </span>
                  </th>
                  <th 
                    className="px-3 py-2 border-r border-slate-100 last:border-none cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort('inputCount')}
                  >
                    <span className="inline-flex items-center gap-1">
                      投入数量
                      <SortIcon field="inputCount" activeField={sortField} direction={sortDirection} />
                    </span>
                  </th>
                  <th 
                    className="px-3 py-2 border-r border-slate-100 last:border-none cursor-pointer hover:bg-slate-100 select-none"
                    onClick={() => handleSort('rtyRate')}
                  >
                    <span className="inline-flex items-center gap-1">
                      直通率 (RTY)
                      <SortIcon field="rtyRate" activeField={sortField} direction={sortDirection} />
                    </span>
                  </th>
                  <th className="px-3 py-2 border-r border-slate-100 last:border-none">直通率指标</th>
                  <th className="px-3 py-2 border-r border-slate-100 last:border-none text-center">达成状况</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-12 text-center text-slate-500">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs text-slate-400">正在加载数据...</span>
                      </div>
                    </td>
                  </tr>
                ) : data.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-slate-500">
                      暂无符合条件的数据
                    </td>
                  </tr>
                ) : (
                  sortedData.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-3 py-2">{row.time}</td>
                      <td className="px-3 py-2">{row.productModel}</td>
                      <td className="px-3 py-2">{row.customer}</td>
                      <td className="px-3 py-2">{row.base}</td>
                      <td className="px-3 py-2">
                        <button 
                          onClick={() => setActiveDefectId(row.id)}
                          className="text-[#dc2626] hover:text-[#b91c1c] hover:underline font-semibold focus:outline-none"
                        >
                          {row.defectCount}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <button 
                          onClick={() => setActiveInputId(row.id)}
                          className="text-[#2563eb] hover:text-[#1d4ed8] hover:underline font-semibold focus:outline-none"
                        >
                          {row.inputCount}
                        </button>
                      </td>
                      <td className="px-3 py-2 font-medium">
                        {row.rtyRate}%
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {modelTargets[row.productModel] || row.targetRate}%
                      </td>
                      <td className="px-3 py-2 text-center">
                        {row.rtyRate >= (modelTargets[row.productModel] || row.targetRate) ? (
                          <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-[2px] bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-medium leading-tight">
                            达成
                          </span>
                        ) : (
                          <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-[2px] bg-red-50 text-red-700 border border-red-200 text-[10px] font-medium leading-tight">
                            未达标
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* 模态框 */}
      {activeDefectId && (
        <DefectModal 
          recordId={activeDefectId} 
          onClose={() => setActiveDefectId(null)} 
        />
      )}
      
      {activeInputId && (
        <InputModal 
          recordId={activeInputId} 
          onClose={() => setActiveInputId(null)} 
        />
      )}
      
      {isAlertModalOpen && (
        <AlertConfigModal 
          onClose={() => setIsAlertModalOpen(false)} 
          rawData={data}
          modelTargets={modelTargets}
        />
      )}
    </div>
  );
}
