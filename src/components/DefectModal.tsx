import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { rtyApi } from '../api/rtyApi';
import { DefectDetail } from '../types';

interface DefectModalProps {
  recordId: string;
  onClose: () => void;
}

export default function DefectModal({ recordId, onClose }: DefectModalProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DefectDetail[]>([]);

  useEffect(() => {
    const fetchDetails = async () => {
      setLoading(true);
      try {
        const details = await rtyApi.getDefectDetails(recordId);
        setData(details);
      } catch (error) {
        console.error("Failed to fetch defect details", error);
      } finally {
        setLoading(false);
      }
    };

    fetchDetails();
  }, [recordId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div 
        className="bg-white rounded-md shadow-xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-200 flex justify-between items-center bg-[#f8fafc]">
          <h3 className="text-base font-semibold text-slate-800">故障数量明细</h3>
          <button 
            onClick={onClose}
            className="p-1 rounded-sm hover:bg-slate-200 text-slate-500 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {loading ? (
            <div className="flex justify-center items-center py-10">
              <div className="animate-pulse flex space-x-2">
                <div className="w-2 h-2 bg-slate-400 rounded-full"></div>
                <div className="w-2 h-2 bg-slate-400 rounded-full"></div>
                <div className="w-2 h-2 bg-slate-400 rounded-full"></div>
              </div>
            </div>
          ) : data.length === 0 ? (
            <div className="text-center text-slate-500 py-10">暂无明细数据</div>
          ) : (
            <div className="border border-slate-200 rounded-sm overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#f8fafc] border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2 font-medium text-slate-700">故障代码</th>
                    <th className="px-4 py-2 font-medium text-slate-700">故障描述</th>
                    <th className="px-4 py-2 font-medium text-slate-700 text-right">数量</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {data.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono text-xs">{item.defectCode}</td>
                      <td className="px-4 py-2.5">{item.description}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-[#dc2626]">{item.count}</td>
                    </tr>
                  ))}
                  <tr className="bg-[#f8fafc] font-semibold border-t border-slate-200">
                    <td colSpan={2} className="px-4 py-2.5 text-right text-slate-700">总计</td>
                    <td className="px-4 py-2.5 text-right text-slate-900">
                      {data.reduce((sum, item) => sum + item.count, 0)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
        
        <div className="px-5 py-3 border-t border-slate-200 bg-[#f8fafc] flex justify-end">
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
