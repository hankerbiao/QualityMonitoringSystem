interface ExportPanelProps {
  columns: Record<string, string>;
  selected: Record<string, boolean>;
  onToggle: (key: string) => void;
  onConfirm: () => void;
  onClose: () => void;
  disabled: boolean;
}

export function ExportPanel({ columns, selected, onToggle, onConfirm, onClose, disabled }: ExportPanelProps) {
  return (
    <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-sm shadow-lg z-50 w-52">
      <div className="px-3 py-2 border-b border-slate-100 text-xs font-semibold text-slate-700 flex justify-between items-center">
        <span>选择导出字段</span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600">×</button>
      </div>
      <div className="p-2 max-h-64 overflow-y-auto">
        {Object.entries(columns).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 py-1 px-1 hover:bg-slate-50 cursor-pointer text-xs text-slate-700">
            <input
              type="checkbox"
              checked={selected[key]}
              onChange={() => onToggle(key)}
              className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600"
            />
            {label}
          </label>
        ))}
      </div>
      <div className="px-3 py-2 border-t border-slate-100 flex justify-end">
        <button
          onClick={onConfirm}
          disabled={disabled}
          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded-sm font-medium disabled:opacity-50"
        >
          {disabled ? '导出中...' : '确认导出'}
        </button>
      </div>
    </div>
  );
}
