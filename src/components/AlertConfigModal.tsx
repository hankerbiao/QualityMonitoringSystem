import { useState, useMemo } from 'react';
import { X, Bell, Calendar } from 'lucide-react';
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

interface AlertConfigModalProps {
  onClose: () => void;
  rawData: RTYData[];
  modelTargets?: Record<string, number>;
}

// 预定义一些颜色，用于图表中的不同机型
const COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16'];

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 获取当前追踪周期（周六→下周五） */
function getCurrentCycle(): string {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=周日, 6=周六
  // 本周六距离今天的天数
  const daysToSaturday = (6 - dayOfWeek + 7) % 7;
  const thisSaturday = new Date(now);
  thisSaturday.setDate(now.getDate() - (dayOfWeek === 6 ? 0 : daysToSaturday));
  
  // 如果今天 < 周六，则周期起始是上一个周六
  const cycleStart = new Date(thisSaturday);
  if (dayOfWeek !== 6) {
    cycleStart.setDate(thisSaturday.getDate() - 7);
  }
  const cycleEnd = new Date(cycleStart);
  cycleEnd.setDate(cycleStart.getDate() + 6);
  
  return `${formatDate(cycleStart)} (${WEEKDAY_NAMES[cycleStart.getDay()]}) - ${formatDate(cycleEnd)} (${WEEKDAY_NAMES[cycleEnd.getDay()]})`;
}

export default function AlertConfigModal({ onClose, rawData = [], modelTargets = {} }: AlertConfigModalProps) {
  const currentCycle = getCurrentCycle();

  // 时间范围快捷键：6 = 近半年, 12 = 近一年, custom = 自定义
  const [timeFilter, setTimeFilter] = useState<'6' | '12' | 'custom'>('6');
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [customEnd, setCustomEnd] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  
  const baseDate = new Date();
  
  const filteredData = useMemo(() => {
    let result = rawData;
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
  }, [rawData, timeFilter, customStart, customEnd]);

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
          const target = modelTargets[model] || 99.0;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div 
        className="bg-white rounded-md shadow-xl border border-slate-200 w-full max-w-6xl overflow-hidden flex flex-col relative"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: '90vh' }}
      >
        <div className="px-5 py-3 border-b border-slate-200 flex justify-between items-center bg-[#f8fafc]">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-slate-700" />
            <h3 className="text-base font-semibold text-slate-800">周期统计</h3>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={onClose}
              className="p-1 rounded-sm hover:bg-slate-200 text-slate-500 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        
        <div className="p-6 overflow-y-auto bg-white flex flex-col gap-6">
          {/* 上方：统计概览，占据全宽 */}
          <div className="flex flex-col gap-4">
            <h4 className="text-sm font-semibold text-slate-800 border-b border-slate-100 pb-2">当前周期统计概览</h4>
            
            <div className="bg-blue-50/50 p-3 rounded-sm border border-blue-100 flex items-start gap-2 w-fit">
              <Calendar className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-medium text-blue-800">监控周期定义 (周六至下周五)</p>
                <p className="text-[11px] text-blue-600 mt-0.5">当前追踪：{currentCycle}</p>
              </div>
            </div>

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
            <div className="flex justify-between items-center mb-4">
              <h4 className="text-sm font-semibold text-slate-800">月度生产量及直通率趋势 (按机型)</h4>
              <div className="flex space-x-4 items-center">
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

            {trendData && trendData.length > 0 && (
              <div className="h-72 w-full text-xs mb-8">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={trendData}
                    margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis 
                      dataKey="time" 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#64748b' }}
                      dy={10}
                    />
                    <YAxis 
                      yAxisId="left" 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#64748b' }}
                    />
                    <YAxis 
                      yAxisId="right" 
                      orientation="right" 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#64748b' }}
                      domain={['dataMin - 5', 100]}
                      tickFormatter={(value) => `${value}%`}
                    />
                    <Tooltip 
                      contentStyle={{ borderRadius: '4px', border: '1px solid #e2e8f0', fontSize: '12px' }}
                    />
                    <Legend wrapperStyle={{ paddingTop: '10px' }} />
                    {trendModels.map((model, index) => (
                      <Bar 
                        key={`bar-${model}`}
                        yAxisId="left" 
                        dataKey={`${model}_input`}
                        name={`${model} (入站数)`} 
                        fill={COLORS[index % COLORS.length]} 
                        radius={[2, 2, 0, 0]}
                        barSize={16}
                      />
                    ))}
                    {trendModels.map((model, index) => (
                      <Line 
                        key={`line-${model}`}
                        yAxisId="right" 
                        type="monotone" 
                        dataKey={`${model}_rty`} 
                        name={`${model} (RTY)`} 
                        stroke={COLORS[index % COLORS.length]} 
                        strokeWidth={2}
                        dot={{ r: 4, strokeWidth: 2 }}
                        activeDot={{ r: 6 }}
                        connectNulls={true}
                      />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
            
            {/* RTY 统计表格 */}
            {tableData && tableData.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-slate-800 mb-3">整体项目质量 RTY 统计</h4>
                <div className="overflow-x-auto border border-slate-200 rounded-sm">
                  <table className="w-full text-left border-collapse min-w-max">
                    <thead className="bg-[#f8fafc] border-b border-slate-200 text-slate-600 font-semibold text-[11px]">
                      <tr>
                        <th className="px-3 py-2 border-r border-slate-100 whitespace-nowrap">项目/时间</th>
                        {allMonths.map(month => (
                          <th key={month} className="px-3 py-2 border-r border-slate-100 whitespace-nowrap text-center">{month}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="text-[11px] text-slate-700">
                      {tableData.map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50 border-b border-slate-100 last:border-none">
                          <td className="px-3 py-2 font-medium border-r border-slate-100">{row.model}</td>
                          {allMonths.map(month => (
                            <td 
                              key={month} 
                              className={`px-3 py-2 text-center border-r border-slate-100 last:border-none ${row[month]?.belowTarget ? 'text-red-600 font-semibold bg-red-50/30' : ''}`}
                            >
                              {row[month]?.text || '-'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
        
        <div className="px-5 py-3 border-t border-slate-200 bg-[#f8fafc] flex justify-end mt-auto">
          <button 
            onClick={onClose}
            className="px-6 py-1.5 bg-[#1e40af] hover:bg-[#1e3a8a] text-white rounded-sm text-sm font-medium transition-colors shadow-sm"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
