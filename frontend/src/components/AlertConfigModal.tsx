import { useState, useMemo, useEffect, useCallback } from 'react';
import { X, Bell, Calendar, Filter, Loader2, FileText } from 'lucide-react';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { RTYData } from '../types';
import { rtyApi } from '../api/rtyApi';
import { useSettings } from '../context/SettingsContext';
import type { RTYFilterParams, CycleStatsConfig } from '../types';

interface AlertConfigModalProps {
  onClose?: () => void;
  modelTargets?: Record<string, number>;
  embedded?: boolean;
  onDetailOpen?: () => void;
}

// 预定义一些颜色，用于图表中的不同机型
const COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16'];

export default function AlertConfigModal({
  onClose,
  modelTargets = {},
  embedded = false,
  onDetailOpen,
}: AlertConfigModalProps) {
  const { settings, updateSettings } = useSettings();

  // 时间范围快捷键：6 = 近半年, 12 = 近一年, custom = 自定义
  const [timeFilter, setTimeFilter] = useState<'6' | '12' | 'custom'>('6');
  
  // 机型筛选状态
  const [selectedModels, setSelectedModels] = useState<Set<string> | null>(null);
  const [showModelFilter, setShowModelFilter] = useState(false);
  const [filterSaved, setFilterSaved] = useState(false);
  
  // 视图模式：chart = 双图表，heatmap = 热力图
  const [viewMode, setViewMode] = useState<'chart' | 'heatmap'>('heatmap');
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [customEnd, setCustomEnd] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  
  // 独立数据拉取（不受主表单影响）
  const [allRawData, setAllRawData] = useState<RTYData[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    try {
      const filters: RTYFilterParams = {
        dateRange: { from: undefined, to: undefined },
        productModel: 'all',
        customer: '',
        base: 'all',
        salesOrder: '',
        productionOrder: '',
        serialNumber: ''
      };
      const pageSize = 500;
      const firstPage = await rtyApi.getRTYData(filters, 1, pageSize);
      const pageCount = Math.ceil(firstPage.total / pageSize);
      if (pageCount === 1) {
        setAllRawData(firstPage.items);
        return;
      }
      const remainingPages = await Promise.all(
        Array.from({ length: pageCount - 1 }, (_, index) =>
          rtyApi.getRTYData(filters, index + 2, pageSize)
        )
      );
      setAllRawData([
        ...firstPage.items,
        ...remainingPages.flatMap(page => page.items),
      ]);
    } catch (error) {
      console.error('Failed to fetch cycle stats data', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // 加载保存的机型筛选配置
  useEffect(() => {
    if (settings.cycleStatsConfig.selectedModels.length > 0) {
      setSelectedModels(new Set(settings.cycleStatsConfig.selectedModels));
    }
  }, [settings.cycleStatsConfig.selectedModels]);

  const baseDate = new Date();
  
  const filteredData = useMemo(() => {
    let result = allRawData;
    if (timeFilter !== 'custom') {
      const monthsToSubtract = parseInt(timeFilter);
      const startDate = new Date(baseDate);
      startDate.setMonth(startDate.getMonth() - monthsToSubtract);
      result = result.filter(item => new Date(item.time) >= startDate);
    } else {
      if (customStart && customEnd) {
        result = result.filter(item => {
          const month = item.time.substring(0, 7);
          return month >= customStart && month <= customEnd;
        });
      }
    }
    return result;
  }, [allRawData, timeFilter, customStart, customEnd]);

  const { trendData, trendModels, tableData, allMonths } = useMemo(() => {
    const map = new Map<string, any>();
    const modelsSet = new Set<string>();

    filteredData.forEach(item => {
      const month = item.time.substring(0, 7);
      if (!map.has(month)) {
        map.set(month, { time: month });
      }
      const current = map.get(month)!;
      
      modelsSet.add(item.productModel);
      
      // 对于每种机型，计算 inputCount 和 (input - defect) / input 的 rty
      if (!current[item.productModel]) {
        current[item.productModel] = { inputCount: 0, defectCount: 0 };
      }
      current[item.productModel].inputCount += item.inputCount;
      current[item.productModel].defectCount += item.defectCount;
    });

    const monthsArray = Array.from(map.keys()).sort();
    const modelsArray = Array.from(modelsSet).sort();

    const chartData = monthsArray.map(month => {
      const item = map.get(month);
      const result: any = { time: month };
      
      modelsArray.forEach(model => {
        if (item[model]) {
          result[`${model}_input`] = item[model].inputCount;
          const rty = ((item[model].inputCount - item[model].defectCount) / item[model].inputCount) * 100;
          result[`${model}_rty`] = Number(rty.toFixed(3));
        } else {
          result[`${model}_input`] = 0;
          // 不要为没有数据的设置 RTY，以免折线图断崖掉到0
        }
      });
      return result;
    });

    // 为表格生成数据
    // 每一行是一个机型，列是月份
    const tblData = modelsArray.map(model => {
      const rowData: any = { model };
      monthsArray.forEach(month => {
        const monthData = map.get(month);
        if (monthData && monthData[model] && monthData[model].inputCount > 0) {
          const rty = ((monthData[model].inputCount - monthData[model].defectCount) / monthData[model].inputCount) * 100;
          const target = modelTargets[model] || 100;
          rowData[month] = {
            text: `${rty.toFixed(3)}% (${monthData[model].defectCount}/${monthData[model].inputCount})`,
            belowTarget: rty < target
          };
        } else {
          rowData[month] = { text: '-' };
        }
      });
      return rowData;
    });

    return { trendData: chartData, trendModels: modelsArray, tableData: tblData, allMonths: monthsArray };
  }, [filteredData]);

  // 根据筛选状态获取实际显示的机型列表
  const displayModels = useMemo(() => {
    if (selectedModels === null) {
      return trendModels;
    }
    return trendModels.filter(m => selectedModels.has(m));
  }, [trendModels, selectedModels]);

  // 机型选择/取消的辅助函数
  const toggleModel = (model: string) => {
    setSelectedModels(prev => {
      const newSet = prev ? new Set(prev) : new Set(trendModels);
      if (newSet.has(model)) {
        newSet.delete(model);
      } else {
        newSet.add(model);
      }
      return newSet;
    });
  };

  const selectAllModels = () => setSelectedModels(null);
  const clearAllModels = () => setSelectedModels(new Set());

  const handleSaveFilter = async () => {
    try {
      const config: CycleStatsConfig = {
        selectedModels: selectedModels ? Array.from(selectedModels) : [],
      };
      await updateSettings({ cycleStatsConfig: config });
      setFilterSaved(true);
      setTimeout(() => setFilterSaved(false), 2000);
    } catch {
      console.error('Failed to save cycle stats config');
    }
  };

  // 计算一下总投入和平均RTY等统计数据
  const { totalInput, totalDefect, avgRty, highestRiskModel, bestModel, maxInputMonth } = useMemo(() => {
    let totalIn = 0;
    let totalDef = 0;
    const modelStats = new Map<string, { in: number, def: number }>();
    const monthStats = new Map<string, number>();

    filteredData.forEach(item => {
      totalIn += item.inputCount;
      totalDef += item.defectCount;

      const model = item.productModel;
      if (!modelStats.has(model)) modelStats.set(model, { in: 0, def: 0 });
      modelStats.get(model)!.in += item.inputCount;
      modelStats.get(model)!.def += item.defectCount;

      const month = item.time.substring(0, 7);
      if (!monthStats.has(month)) monthStats.set(month, 0);
      monthStats.set(month, monthStats.get(month)! + item.inputCount);
    });

    const rty = totalIn > 0 ? ((totalIn - totalDef) / totalIn) * 100 : 0;

    let highestRisk = "无";
    let highestDefectRate = -1;
    let best = "无";
    let bestRty = -1;

    modelStats.forEach((stats, model) => {
      if (stats.in > 0) {
        const defectRate = stats.def / stats.in;
        const currentRty = (stats.in - stats.def) / stats.in;
        if (defectRate > highestDefectRate) {
          highestDefectRate = defectRate;
          highestRisk = model;
        }
        if (currentRty > bestRty) {
          bestRty = currentRty;
          best = model;
        }
      }
    });

    let maxInMonth = "无";
    let maxIn = -1;
    monthStats.forEach((val, month) => {
      if (val > maxIn) {
        maxIn = val;
        maxInMonth = month;
      }
    });

    return { 
      totalInput: totalIn, 
      totalDefect: totalDef,
      avgRty: rty.toFixed(2),
      highestRiskModel: highestRisk,
      bestModel: best,
      maxInputMonth: maxInMonth
    };
  }, [filteredData]);

  return (
    <div className={embedded ? 'h-full' : 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm'}>
      <div 
        className={`bg-white rounded-md border border-slate-200 w-full overflow-hidden flex flex-col relative ${embedded ? 'h-full' : 'max-w-6xl shadow-xl'}`}
        onClick={(e) => e.stopPropagation()}
        style={embedded ? undefined : { maxHeight: '90vh' }}
      >
        <div className="px-5 py-3 border-b border-slate-200 flex justify-between items-center bg-[#f8fafc]">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-slate-700" />
            <h3 className="text-base font-semibold text-slate-800">周期统计</h3>
          </div>
          <div className="flex items-center gap-4">
            {embedded && onDetailOpen && (
              <button
                onClick={onDetailOpen}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <FileText className="w-3.5 h-3.5 text-blue-600" />
                详情
              </button>
            )}
            {!embedded && (
              <button
                onClick={() => onClose?.()}
                className="p-1 rounded-sm hover:bg-slate-200 text-slate-500 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        
        <div className="p-6 overflow-y-auto bg-white flex flex-col gap-6 relative">
          {loading && (
            <div className="absolute inset-0 z-20 bg-white/70 flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
            </div>
          )}
          <div className="flex flex-col gap-4">
            <h4 className="text-sm font-semibold text-slate-800 border-b border-slate-100 pb-2">当前周期统计概览</h4>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="p-3 border border-slate-200 rounded-sm bg-slate-50">
                <p className="text-[11px] text-slate-500 font-semibold mb-1">周期内累计投入</p>
                <p className="text-lg font-bold text-slate-800">{totalInput.toLocaleString()} <span className="text-xs font-normal text-slate-500">台</span></p>
              </div>
              <div className="p-3 border border-slate-200 rounded-sm bg-slate-50">
                <p className="text-[11px] text-slate-500 font-semibold mb-1">综合平均直通率</p>
                <p className="text-lg font-bold text-slate-800">{avgRty}%</p>
              </div>
              <div className="p-3 border border-slate-200 rounded-sm bg-slate-50">
                <p className="text-[11px] text-slate-500 font-semibold mb-1">周期内总故障数</p>
                <p className="text-lg font-bold text-slate-800">{totalDefect.toLocaleString()} <span className="text-xs font-normal text-slate-500">件</span></p>
              </div>
              <div className="p-3 border border-slate-200 rounded-sm bg-slate-50">
                <p className="text-[11px] text-slate-500 font-semibold mb-1">产量最高月份</p>
                <p className="text-lg font-bold text-slate-800">{maxInputMonth}</p>
              </div>
              <div className="p-3 border border-slate-200 rounded-sm bg-slate-50">
                <p className="text-[11px] text-slate-500 font-semibold mb-1">高风险机型 (故障率最高)</p>
                <p className="text-sm font-bold text-slate-800 mt-1 truncate" title={highestRiskModel}>{highestRiskModel}</p>
              </div>
              <div className="p-3 border border-slate-200 rounded-sm bg-slate-50">
                <p className="text-[11px] text-slate-500 font-semibold mb-1">最佳表现机型 (RTY最高)</p>
                <p className="text-sm font-bold text-slate-800 mt-1 truncate" title={bestModel}>{bestModel}</p>
              </div>
            </div>
          </div>

          {/* 下方：趋势图表及表格 */}
          <div className="w-full border-t border-slate-100 pt-6">
            <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
              <div className="flex items-center gap-3">
                <h4 className="text-sm font-semibold text-slate-800">月度生产量及直通率趋势 (按机型)</h4>
                {/* 视图切换 */}
                <div className="flex border border-slate-200 rounded-sm overflow-hidden">
                  <button
                    onClick={() => setViewMode('heatmap')}
                    className={`px-3 py-1 text-xs ${viewMode === 'heatmap' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                  >
                    热力图
                  </button>
                  <button
                    onClick={() => setViewMode('chart')}
                    className={`px-3 py-1 text-xs border-l border-slate-200 ${viewMode === 'chart' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                  >
                    趋势图
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {/* 机型筛选 */}
                <div className="relative">
                  <button 
                    onClick={() => setShowModelFilter(!showModelFilter)}
                    className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-sm border ${showModelFilter || selectedModels !== null ? 'bg-blue-50 border-blue-200 text-blue-700 font-medium' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    <Filter className="w-3 h-3" />
                    机型筛选
                    {selectedModels !== null && (
                      <span className="ml-1 px-1.5 py-0.5 bg-blue-600 text-white rounded text-[10px]">
                        {selectedModels.size}
                      </span>
                    )}
                  </button>
                  
                  {showModelFilter && (
                    <div className="absolute top-full right-0 mt-1 bg-white border border-slate-200 rounded-sm shadow-lg z-10 p-3 min-w-48">
                      <div className="flex gap-2 mb-2 pb-2 border-b border-slate-100">
                        <button 
                          onClick={selectAllModels}
                          className="text-xs text-blue-600 hover:text-blue-800"
                        >
                          全选
                        </button>
                        <button 
                          onClick={clearAllModels}
                          className="text-xs text-slate-500 hover:text-slate-700"
                        >
                          清空
                        </button>
                      </div>
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {trendModels.map(model => {
                          const isSelected = selectedModels === null || selectedModels.has(model);
                          return (
                            <label key={model} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 px-1 py-0.5 rounded">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleModel(model)}
                                className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600"
                              />
                              <span className="text-xs text-slate-700 truncate" title={model}>{model}</span>
                            </label>
                          );
                        })}
                      </div>
                      <div className="mt-2 pt-2 border-t border-slate-100">
                        <button
                          onClick={handleSaveFilter}
                          className="w-full px-2 py-1 text-xs bg-blue-600 text-white rounded-sm hover:bg-blue-700 transition-colors font-medium"
                        >
                          保存筛选
                        </button>
                        {filterSaved && (
                          <p className="text-[10px] text-emerald-600 mt-1 text-center font-medium">✓ 已保存</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="flex space-x-2">
                  <button 
                    onClick={() => setTimeFilter('6')}
                    className={`px-3 py-1 text-xs rounded-sm border ${timeFilter === '6' ? 'bg-blue-50 border-blue-200 text-blue-700 font-medium' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    近半年
                  </button>
                  <button 
                    onClick={() => setTimeFilter('12')}
                    className={`px-3 py-1 text-xs rounded-sm border ${timeFilter === '12' ? 'bg-blue-50 border-blue-200 text-blue-700 font-medium' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    近一年
                  </button>
                </div>
                
                {/* 自定义日期选择器 */}
                <div className="flex items-center space-x-2 border border-slate-300 rounded-sm bg-white px-2 py-1">
                  <input 
                    type="month" 
                    className="text-xs text-slate-700 outline-none bg-transparent"
                    value={customStart}
                    onChange={(e) => { setCustomStart(e.target.value); setTimeFilter('custom'); }}
                  />
                  <span className="text-slate-400 text-xs">~</span>
                  <input 
                    type="month" 
                    className="text-xs text-slate-700 outline-none bg-transparent"
                    value={customEnd}
                    onChange={(e) => { setCustomEnd(e.target.value); setTimeFilter('custom'); }}
                  />
                  <Calendar className="w-3.5 h-3.5 text-slate-400 ml-1" />
                </div>
              </div>
            </div>

            {trendData && trendData.length > 0 && viewMode === 'chart' && (
              <div className="mb-8 border border-slate-200 rounded-sm p-4 bg-white">
                <div className="flex justify-between items-center mb-3">
                  <h5 className="text-xs font-semibold text-slate-700">产量（WMENG）与直通率（RTY）</h5>
                  <span className="text-[10px] text-slate-400">柱：台 · 线：%</span>
                </div>
                <div className="h-72 text-xs">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={trendData} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 10 }} dy={8} />
                      <YAxis yAxisId="input" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 10 }} />
                      <YAxis yAxisId="rty" orientation="right" domain={['dataMin - 2', 100]} axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={(value) => `${value}%`} />
                      <Tooltip
                        contentStyle={{ borderRadius: '4px', border: '1px solid #e2e8f0', fontSize: '11px' }}
                        formatter={(value, name) => name?.toString().includes('RTY') ? `${Number(value).toFixed(3)}%` : Number(value).toLocaleString()}
                      />
                      <Legend wrapperStyle={{ paddingTop: '8px', fontSize: '10px' }} />
                      {displayModels.map((model, index) => (
                        <Bar key={`bar-${model}`} dataKey={`${model}_input`} name={`${model} 产量`} yAxisId="input" fill={COLORS[index % COLORS.length]} fillOpacity={0.55} radius={[2, 2, 0, 0]} maxBarSize={24} />
                      ))}
                      {displayModels.map((model, index) => (
                        <Line key={`line-${model}`} type="monotone" dataKey={`${model}_rty`} name={`${model} RTY`} yAxisId="rty" stroke={COLORS[index % COLORS.length]} strokeWidth={2} dot={{ r: 3, strokeWidth: 1 }} activeDot={{ r: 5 }} connectNulls={true} />
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
            
            {/* 热力图模式 */}
            {trendData && trendData.length > 0 && viewMode === 'heatmap' && (
              <div className="mb-8">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-4">
                    <h5 className="text-xs font-semibold text-slate-700">RTY 热力图</h5>
                    <div className="flex items-center gap-4 text-[10px] text-slate-500">
                      <span className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded-sm bg-green-500 inline-block"></span>
                        达成
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded-sm bg-red-500 inline-block"></span>
                        未达成
                      </span>
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto border border-slate-200 rounded-sm">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-[#f8fafc] border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2 border-r border-slate-100 text-[11px] font-semibold text-slate-600 whitespace-nowrap sticky left-0 bg-[#f8fafc] z-10">机型</th>
                        {allMonths.map(month => (
                          <th key={month} className="px-2 py-2 border-r border-slate-100 text-[10px] text-slate-500 text-center min-w-[60px]">{month}</th>
                        ))}
                        <th className="px-2 py-2 border-r border-slate-100 text-[10px] font-semibold text-slate-500 text-center bg-slate-100">平均</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableData
                        .filter(row => displayModels.includes(row.model))
                        .map((row, idx) => {
                        const validMonths = allMonths.filter(m => row[m]?.text && row[m].text !== '-');
                        const avgRty = validMonths.length > 0 
                          ? validMonths.reduce((sum, m) => {
                              const match = row[m]?.text?.match(/^([\d.]+)%/);
                              return sum + (match ? parseFloat(match[1]) : 0);
                            }, 0) / validMonths.length
                          : 0;
                        
                        return (
                          <tr key={idx} className="border-b border-slate-100 last:border-none hover:bg-slate-50/50">
                            <td className="px-3 py-2 border-r border-slate-100 text-[11px] font-medium text-slate-700 whitespace-nowrap sticky left-0 bg-white z-10">
                              {row.model}
                            </td>
                            {allMonths.map(month => {
                              const cell = row[month];
                              const hasData = cell?.text && cell?.text !== '-';
                              const rtyMatch = cell?.text?.match(/^([\d.]+)%/);
                              const rty = rtyMatch ? parseFloat(rtyMatch[1]) : null;
                              
                              let bgClass = 'bg-slate-50';
                              let textClass = 'text-slate-400';
                              let fontClass = '';
                              
                              if (hasData && rty !== null) {
                                if (cell.belowTarget) {
                                  bgClass = 'bg-red-100';
                                  textClass = 'text-red-700';
                                  fontClass = 'font-semibold';
                                } else {
                                  bgClass = 'bg-green-100';
                                  textClass = 'text-green-700';
                                }
                              }
                              
                              return (
                                <td 
                                  key={month} 
                                  className={`px-2 py-2 border-r border-slate-100 text-center text-[10px] ${bgClass} ${textClass} ${fontClass}`}
                                  title={cell?.text || ''}
                                >
                                  {hasData ? (
                                    <div className="leading-tight">
                                      <div className="font-semibold">{rty?.toFixed(2)}%</div>
                                      <div className="mt-0.5 text-[9px] opacity-75">{cell.text.split('(')[1]?.replace(')', '') || '-'}</div>
                                    </div>
                                  ) : '-'}
                                </td>
                              );
                            })}
                            <td className={`px-2 py-2 border-r border-slate-100 text-center text-[10px] font-semibold bg-slate-100 ${avgRty >= 99.5 ? 'text-green-700' : 'text-red-600'}`}>
                              {avgRty > 0 ? `${avgRty.toFixed(2)}%` : '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                
                <p className="text-[10px] text-slate-400 mt-2">单元格上方为 RTY，下方为故障数/产量（WMENG）</p>
              </div>
            )}
          </div>
        </div>
        
        {!embedded && (
          <div className="px-5 py-3 border-t border-slate-200 bg-[#f8fafc] flex justify-end mt-auto">
            <button
              onClick={() => onClose?.()}
              className="px-6 py-1.5 bg-[#1e40af] hover:bg-[#1e3a8a] text-white rounded-sm text-sm font-medium transition-colors shadow-sm"
            >
              关闭
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
