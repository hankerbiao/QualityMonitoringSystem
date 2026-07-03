import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, BellRing, Edit3, BarChart3 } from 'lucide-react';
import { rtyApi, RTYFilterParams } from '../api/rtyApi';
import { RTYData, DefectDetail, InputDetail } from '../types';
import DefectModal from '../components/DefectModal';
import InputModal from '../components/InputModal';
import AlertConfigModal from '../components/AlertConfigModal';
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
  
  // 弹窗状态
  const [activeDefectId, setActiveDefectId] = useState<string | null>(null);
  const [activeInputId, setActiveInputId] = useState<string | null>(null);
  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  const [isTargetModalOpen, setIsTargetModalOpen] = useState(false);
  
  // 机型直通率标准配置状态
  const [modelTargets, setModelTargets] = useState<Record<string, number>>({
    '6210 C21 BOX': 99.0,
    '6210 C21': 99.0,
    '6210 C31': 99.0,
    '普通机型': 99.0
  });

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
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = () => {
    fetchData();
  };

  const trendDataInfo = useMemo(() => {
    const map = new Map<string, any>();
    const modelsSet = new Set<string>();

    data.forEach(item => {
      const month = item.time.substring(0, 7);
      if (!map.has(month)) {
        map.set(month, { time: month, rtySum: 0, count: 0 });
      }
      const current = map.get(month)!;
      
      current.rtySum += item.rtyRate;
      current.count += 1;
      
      modelsSet.add(item.productModel);
      if (!current[item.productModel]) {
        current[item.productModel] = 0;
      }
      current[item.productModel] += item.inputCount;
    });

    const trendData = Array.from(map.values())
      .sort((a, b) => a.time.localeCompare(b.time))
      .map(item => {
        const result: any = {
          time: item.time,
          rtyRate: Number((item.rtySum / item.count).toFixed(2))
        };
        Array.from(modelsSet).forEach(model => {
          result[model] = item[model] || 0;
        });
        return result;
      });

    return { trendData, models: Array.from(modelsSet) };
  }, [data]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* 顶部导航 */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center sticky top-0 z-10">
        <button 
          onClick={() => navigate('/')}
          className="mr-3 p-1.5 hover:bg-slate-100 rounded-sm transition-colors text-slate-500"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-lg font-semibold text-slate-800">RTY 整机综合直通率</h1>
        </div>
      </header>

      <main className="flex-1 p-4 max-w-full mx-auto w-full">
        {/* 过滤面板 */}
        <div className="bg-white p-3 rounded-md border border-slate-200 shadow-sm mb-4">
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
              <div className="flex-shrink-0 ml-auto flex items-center gap-2">
                <button 
                  onClick={() => setIsAlertModalOpen(true)}
                  className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-1.5 rounded-sm text-xs font-medium transition-colors flex items-center shadow-sm"
                >
                  <BarChart3 className="w-3.5 h-3.5 mr-1.5 text-blue-500" />
                  周期统计
                </button>
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
        <div className="bg-white rounded-md border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#f8fafc] border-b border-slate-200 text-slate-600 font-semibold text-xs">
                <tr>
                  <th className="px-3 py-2 border-r border-slate-100 last:border-none">时间</th>
                  <th className="px-3 py-2 border-r border-slate-100 last:border-none">生产机型</th>
                  <th className="px-3 py-2 border-r border-slate-100 last:border-none">客户</th>
                  <th className="px-3 py-2 border-r border-slate-100 last:border-none">基地</th>
                  <th className="px-3 py-2 border-r border-slate-100 last:border-none">故障数量</th>
                  <th className="px-3 py-2 border-r border-slate-100 last:border-none">投入数量</th>
                  <th className="px-3 py-2 border-r border-slate-100 last:border-none">直通率 (RTY)</th>
                  <th className="px-3 py-2 border-r border-slate-100 last:border-none">直通率指标</th>
                  <th className="px-3 py-2 border-r border-slate-100 last:border-none text-center">达成状况</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-slate-500">
                      数据加载中...
                    </td>
                  </tr>
                ) : data.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-slate-500">
                      暂无符合条件的数据
                    </td>
                  </tr>
                ) : (
                  data.map((row) => (
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
