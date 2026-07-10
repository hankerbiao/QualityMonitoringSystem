import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { DefectDetail } from '../types';
import { rtyApi } from '../api/rtyApi';

interface DefectModalProps {
  productionOrder: string;
  onClose: () => void;
}

export default function DefectModal({ productionOrder, onClose }: DefectModalProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DefectDetail[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const orders = productionOrder.split(',').map(o => o.trim()).filter(Boolean);
        const allDefects: DefectDetail[] = [];
        
        for (const order of orders) {
          const defects = await rtyApi.getDefectDetailsByOrder(order);
          allDefects.push(...defects);
        }
        
        setData(allDefects);
      } catch (err) {
        console.error('Failed to fetch defect details', err);
        setError('数据加载失败');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [productionOrder]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-white rounded-md shadow-xl border border-slate-200 w-full max-w-4xl overflow-hidden flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-200 flex justify-between items-center bg-[#f8fafc]">
          <h3 className="text-base font-semibold text-slate-800">
            故障明细（{productionOrder}）
          </h3>
          <button 
            onClick={onClose}
            className="p-1 rounded-sm hover:bg-slate-200 text-slate-500 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center items-center py-10">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-10 text-red-500">{error}</div>
          ) : data.length === 0 ? (
            <div className="text-center py-10 text-slate-500">暂无明细数据</div>
          ) : (
            <div className="border border-slate-200 rounded-sm overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#f8fafc] border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2 font-medium text-slate-700 w-32">机器SN</th>
                    <th className="px-4 py-2 font-medium text-slate-700 w-28">故障类型</th>
                    <th className="px-4 py-2 font-medium text-slate-700">故障描述</th>
                    <th className="px-4 py-2 font-medium text-slate-700 w-28">维修人</th>
                    <th className="px-4 py-2 font-medium text-slate-700 w-32">维修时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {data.map((item) => (
                    <tr key={`${item.id}-${item.sn}`} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono text-xs w-32 break-all">{item.sn}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-700 w-28">{item.defectCode}</td>
                      <td className="px-4 py-2.5 text-slate-600 text-xs">{item.description}</td>
                      <td className="px-4 py-2.5 w-28">{item.repairPerson}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-500 w-32">{item.repairTime}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        
        <div className="px-5 py-3 border-t border-slate-200 bg-[#f8fafc] flex justify-between items-center">
          <span className="text-sm text-slate-500">共 {data.length} 条记录</span>
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