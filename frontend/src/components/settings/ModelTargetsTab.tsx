import { useState } from 'react';

interface ModelTargetsTabProps {
  targets: Record<string, number>;
  onChange: (targets: Record<string, number>) => void;
}

export function ModelTargetsTab({ targets, onChange }: ModelTargetsTabProps) {
  const handleTargetChange = (model: string, value: string) => {
    const num = parseFloat(value);
    onChange({ ...targets, [model]: isNaN(num) ? 0 : num });
  };

  const handleRemoveModel = (model: string) => {
    const next = { ...targets };
    delete next[model];
    onChange(next);
  };

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div>
        <h3 className="text-base font-semibold text-slate-800 mb-1">直通率标准配置</h3>
        <p className="text-sm text-slate-500 mb-4">按机型配置 RTY 目标合格率，系统将据此进行达标判定。</p>
      </div>
      <div className="flex-1 flex flex-col min-h-0">
        <div className="border border-slate-200 rounded-md overflow-hidden flex-1 overflow-y-auto mb-4">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium sticky top-0">
              <tr>
                <th className="px-4 py-3 border-r border-slate-100 w-1/2">机型名称</th>
                <th className="px-4 py-3 border-r border-slate-100 w-1/3">直通率标准 (%)</th>
                <th className="px-4 py-3 text-center w-1/6">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {Object.entries(targets).map(([model, target]) => (
                <tr key={model} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2 border-r border-slate-100 font-medium text-slate-800">{model}</td>
                  <td className="px-4 py-2 border-r border-slate-100">
                    <div className="flex items-center gap-2 max-w-[120px]">
                      <input
                        type="number"
                        step="0.1"
                        value={target}
                        onChange={(e) => handleTargetChange(model, e.target.value)}
                        className="w-full border border-slate-300 rounded text-right px-2 py-1 text-sm outline-none focus:border-blue-500"
                      />
                      <span className="text-slate-500 font-medium">%</span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <button
                      onClick={() => handleRemoveModel(model)}
                      className="text-red-500 hover:text-red-700 transition-colors text-xs font-medium"
                    >删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <AddModelForm onAdd={(model, target) => onChange({ ...targets, [model]: target })} />
      </div>
    </div>
  );
}

function AddModelForm({ onAdd }: { onAdd: (model: string, target: number) => void }) {
  const [newModel, setNewModel] = useState('');
  const [newTarget, setNewTarget] = useState('');

  const handleSubmit = () => {
    if (newModel && newTarget) {
      const num = parseFloat(newTarget);
      if (!isNaN(num)) {
        onAdd(newModel, num);
        setNewModel('');
        setNewTarget('');
      }
    }
  };

  return (
    <div className="p-4 bg-slate-50 border border-slate-200 rounded-md flex items-end gap-3 shrink-0">
      <div className="flex-1">
        <label className="block text-xs font-medium text-slate-600 mb-1.5">新增机型</label>
        <input
          type="text"
          placeholder="例如: 6410 X21"
          value={newModel}
          onChange={(e) => setNewModel(e.target.value)}
          className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm outline-none focus:border-blue-500"
        />
      </div>
      <div className="w-32">
        <label className="block text-xs font-medium text-slate-600 mb-1.5">目标 (%)</label>
        <input
          type="number"
          placeholder="98.5"
          step="0.1"
          value={newTarget}
          onChange={(e) => setNewTarget(e.target.value)}
          className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm outline-none focus:border-blue-500"
        />
      </div>
      <button
        onClick={handleSubmit}
        disabled={!newModel || !newTarget}
        className="px-4 py-1.5 bg-slate-800 text-white text-sm font-medium rounded-md hover:bg-slate-700 transition-colors disabled:opacity-50 h-[34px]"
      >添加</button>
    </div>
  );
}