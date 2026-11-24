import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { DefectDetail, RTYFilterParams } from '../types';
import { rtyApi } from '../api/rtyApi';
import { REPAIR_DETAIL_COLUMNS } from './rty/repairDetailColumns';

interface DefectModalProps {
  filters: RTYFilterParams;
  filterLabel: string;
  onClose: () => void;
}

export default function DefectModal({ filters, filterLabel, onClose }: DefectModalProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DefectDetail[]>([]);
  const [error, setError] = useState<string | null>(null);
  const faultyMachineCount = useMemo(
    () => new Set(data.map(item => item.sn).filter(Boolean)).size,
    [data],
  );

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const defects = await rtyApi.getDefectDetailsByFilters(filters);
        setData(defects);
      } catch (err) {
        console.error('Failed to fetch defect details', err);
        setError('数据加载失败');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [filters]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-white rounded-md shadow-xl border border-slate-200 w-full max-w-6xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-200 flex justify-between items-center bg-[#f8fafc]">
          <h3 className="text-base font-semibold text-slate-800">
            故障明细{filterLabel ? `（${filterLabel}）` : ''}
          </h3>
          <button 
            onClick={onClose}
            className="p-1 rounded-sm hover:bg-slate-200 text-slate-500 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        
        <div className="p-4 overflow-auto">
          {loading ? (
            <div className="flex justify-center items-center py-10">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-10 text-red-500">{error}</div>
          ) : data.length === 0 ? (
            <div className="text-center py-10 text-slate-500">暂无明细数据</div>
          ) : (
            <div className="border border-slate-200 rounded-sm overflow-x-auto">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-[#f8fafc] border-b border-slate-200">
                  <tr>
                    {REPAIR_DETAIL_COLUMNS.map(([key, label]) => <th key={key} className="px-3 py-2 font-medium text-slate-700">{label}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {data.map((item) => (
                    <tr key={`${item.id}-${item.sn}`} className="hover:bg-slate-50">
                      {REPAIR_DETAIL_COLUMNS.map(([key]) => (
                        <td key={key} className="max-w-64 truncate px-3 py-2" title={item.repairFields?.[key]}>{item.repairFields?.[key] || '-'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        
        <div className="px-5 py-3 border-t border-slate-200 bg-[#f8fafc] flex justify-between items-center">
          <span className="text-sm text-slate-500">
            {data.length} 条维修记录，涉及 {faultyMachineCount} 台故障机器
          </span>
          <button 
            onClick={onClose}
            className="px-4 py-1.5 bg-white border border-slate-300 rounded-sm text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
