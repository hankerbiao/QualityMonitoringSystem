import React, { useState } from 'react';
import { X, Save, Edit3 } from 'lucide-react';

interface TargetConfigModalProps {
  onClose: () => void;
  modelTargets: Record<string, number>;
  onSave: (newTargets: Record<string, number>) => void;
}

export default function TargetConfigModal({ onClose, modelTargets, onSave }: TargetConfigModalProps) {
  const [targets, setTargets] = useState<Record<string, number>>({ ...modelTargets });
  const [newModel, setNewModel] = useState('');
  const [newTarget, setNewTarget] = useState('');

  const handleTargetChange = (model: string, value: string) => {
    const num = parseFloat(value);
    setTargets({
      ...targets,
      [model]: isNaN(num) ? 0 : num
    });
  };

  const handleAddModel = () => {
    if (newModel && newTarget) {
      const num = parseFloat(newTarget);
      if (!isNaN(num)) {
        setTargets({
          ...targets,
          [newModel]: num
        });
        setNewModel('');
        setNewTarget('');
      }
    }
  };

  const handleRemoveModel = (model: string) => {
    const newTargets = { ...targets };
    delete newTargets[model];
    setTargets(newTargets);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div 
        className="bg-white rounded-md shadow-xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-200 flex justify-between items-center bg-[#f8fafc]">
          <div className="flex items-center gap-2">
            <Edit3 className="w-4 h-4 text-slate-700" />
            <h3 className="text-base font-semibold text-slate-800">机型直通率标准配置</h3>
          </div>
          <button 
            onClick={onClose}
            className="p-1 rounded-sm hover:bg-slate-200 text-slate-500 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto bg-white flex flex-col gap-4 max-h-[70vh]">
          <div className="text-sm text-slate-600 mb-2">
            在此维护各生产机型的直通率（RTY）考核达标标准。
          </div>
          
          <div className="border border-slate-200 rounded-sm overflow-hidden">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#f8fafc] border-b border-slate-200 text-slate-600 font-semibold text-xs">
                <tr>
                  <th className="px-4 py-2 border-r border-slate-100 w-1/2">机型名称</th>
                  <th className="px-4 py-2 border-r border-slate-100 w-1/3">直通率标准 (%)</th>
                  <th className="px-4 py-2 text-center w-1/6">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
                {Object.entries(targets).map(([model, target]) => (
                  <tr key={model} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2 border-r border-slate-100 font-medium">
                      {model}
                    </td>
                    <td className="px-4 py-2 border-r border-slate-100">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="0.1"
                          value={target}
                          onChange={(e) => handleTargetChange(model, e.target.value)}
                          className="w-full border border-slate-300 rounded-sm px-2 py-1 text-xs outline-none focus:border-blue-500"
                        />
                        <span className="text-slate-500">%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-center">
                      <button 
                        onClick={() => handleRemoveModel(model)}
                        className="text-red-500 hover:text-red-700 transition-colors"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-sm flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-600 mb-1">新增机型</label>
              <input 
                type="text"
                placeholder="机型名称"
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
                className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-600 mb-1">指标 (%)</label>
              <input 
                type="number"
                placeholder="例如: 98.5"
                step="0.1"
                value={newTarget}
                onChange={(e) => setNewTarget(e.target.value)}
                className="w-full border border-slate-300 rounded-sm px-2 py-1.5 text-xs outline-none focus:border-blue-500"
              />
            </div>
            <button 
              onClick={handleAddModel}
              disabled={!newModel || !newTarget}
              className="px-3 py-1.5 bg-slate-800 text-white text-xs rounded-sm hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              添加
            </button>
          </div>
        </div>
        
        <div className="px-5 py-3 border-t border-slate-200 bg-[#f8fafc] flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-4 py-1.5 bg-white border border-slate-300 rounded-sm text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
          >
            取消
          </button>
          <button 
            onClick={() => {
              onSave(targets);
              onClose();
            }}
            className="px-4 py-1.5 bg-[#1e40af] hover:bg-[#1e3a8a] text-white rounded-sm text-sm font-medium transition-colors shadow-sm flex items-center gap-1.5"
          >
            <Save className="w-4 h-4" />
            保存配置
          </button>
        </div>
      </div>
    </div>
  );
}
